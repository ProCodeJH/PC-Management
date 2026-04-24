// server.js
// Central PC Management Dashboard - Backend API
// v22.0 — Full Reconciliation + AI Vision + Schedule + PWA
// Phases 1-20: Security, Modular, Logging, Validation, WebSocket Auth,
//              DB Wrapper, LRU Cache, Response Standard, Cluster, Audit,
//              Scheduler, Upload, API Docs, Metrics, Production Polish

// Load environment variables FIRST
require('dotenv').config();
// Single source of truth for version — read from package.json
const PKG_VERSION = (() => {
    try { return require('./package.json').version; }
    catch (e) { return '0.0.0'; }
})();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const crypto = require('crypto');

// ========================================
// Shared Modules (Phases 8-19)
// ========================================
const config = require('./config');
const { isValidIP, sanitizeForPS } = require('./utils/helpers');
const { errorHandler, notFoundHandler } = require('./error.middleware');
const cache = require('./utils/cache');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');
const audit = require('./utils/audit');
const scheduler = require('./utils/scheduler');
const ApiResponse = require('./utils/response');
const validate = require('./utils/validators');
const DatabaseWrapper = require('./utils/db');

// Supabase Mirroring (best-effort)
const mirror = require('./services/supabaseMirror');

// Security Modules
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Auth Middleware
const { generateToken, authenticateToken, optionalAuth, requireRole, getSecret } = require('./auth.middleware');

// License Verification
const { verifyLicense } = require('./license');
const licenseInfo = verifyLicense();
if (!licenseInfo.valid) {
    console.error('\n========================================');
    console.error('  라이선스 오류: ' + licenseInfo.error);
    console.error('  license.key 파일을 확인하세요.');
    console.error('========================================\n');
    process.exit(1);
}
console.log(`[License] ${licenseInfo.academy} / ${licenseInfo.maxPCs}대 / ${licenseInfo.expiry}까지`);

const app = express();
const server = http.createServer(app);

// ========================================
// Socket.IO with Auth (Phase 10)
// ========================================
const io = socketIO(server, {
    cors: {
        origin: config.CORS_ORIGIN,
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 5e7, // 50MB for high-quality streaming
    pingTimeout: 60000,
    pingInterval: 25000,
    // Disable perMessageDeflate — binary frames (JPEG/H.264) are already compressed,
    // and deflate on control messages wastes more CPU than it saves on LAN.
    perMessageDeflate: false,
});

// WebSocket connection tracking (Phase 10)
const wsConnections = new Map(); // ip -> count
const pcSockets = new Map(); // pcName -> socketId
const _cachedHostname = (require('os').hostname() || '').toLowerCase();

io.use((socket, next) => {
    // Rate limit per IP
    const ip = socket.handshake.address;
    const count = wsConnections.get(ip) || 0;
    if (count >= config.WS_MAX_CONNECTIONS_PER_IP) {
        logger.warn(`WebSocket rate limit: ${ip} (${count} connections)`);
        return next(new Error('Too many connections'));
    }
    wsConnections.set(ip, count + 1);

    // Optional JWT auth for WS — uses same secret as REST auth
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
        try {
            const jwt = require('jsonwebtoken');
            socket.user = jwt.verify(token, getSecret());
        } catch (e) {
            logger.debug(`WS auth failed for ${ip}: ${e.message}`);
        }
    }
    next();
});

// ========================================
// Security Middleware (Phase 1, 15)
// ========================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Request ID tracking (Phase 13)
app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Powered-By', 'JHS-PC-Manager/v' + PKG_VERSION);
    next();
});

// Metrics middleware (Phase 19)
if (config.METRICS_ENABLED) {
    app.use(metrics.middleware());
}

// Request logging (Phase 8)
app.use(logger.requestLogger());

// Rate Limiting (Phase 1, 15)
app.use('/api/', rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX,
    message: { success: false, error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
}));
app.use('/api/auth/login', rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.LOGIN_RATE_LIMIT_MAX,
    message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' }
}));

// Core Middleware
app.use(compression({ level: 6, threshold: 512 })); // Level 6: good balance speed/ratio
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend'), {
    maxAge: '5m',
    etag: true,
    lastModified: true,
}));
app.use(express.static('public', { maxAge: 0 }));

// Request timeout (Phase 20)
app.use((req, res, next) => {
    req.setTimeout(config.REQUEST_TIMEOUT_MS);
    next();
});


// ========================================
// Database Setup (Phase 7, 11)
// ========================================
const rawDb = new sqlite3.Database(config.DB_PATH);
const db = rawDb; // Keep raw for route DI compatibility
const dbWrapper = new DatabaseWrapper(rawDb);

rawDb.serialize(() => {
    // Performance PRAGMAs — Phase 7 (tuned for Phase 20)
    rawDb.run(`PRAGMA journal_mode = WAL`);
    rawDb.run(`PRAGMA synchronous = ${config.DB_SYNCHRONOUS}`);
    rawDb.run(`PRAGMA cache_size = ${config.DB_CACHE_SIZE}`);
    rawDb.run(`PRAGMA temp_store = MEMORY`);
    rawDb.run(`PRAGMA mmap_size = ${config.DB_MMAP_SIZE}`);
    rawDb.run(`PRAGMA busy_timeout = ${config.DB_BUSY_TIMEOUT}`);
    // page_size & auto_vacuum can only be set on new DBs — skipped for compatibility
    rawDb.run(`PRAGMA optimize`);

    // Tables
    rawDb.run(`CREATE TABLE IF NOT EXISTS pc_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        status TEXT DEFAULT 'offline',
        cpu_usage REAL DEFAULT 0,
        memory_usage REAL DEFAULT 0,
        group_id INTEGER,
        display_name TEXT,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Migration: add display_name, sort_order if not exists
    rawDb.all(`PRAGMA table_info(pc_status)`, (err, cols) => {
        if (cols && !cols.find(c => c.name === 'display_name'))
            rawDb.run(`ALTER TABLE pc_status ADD COLUMN display_name TEXT`);
        if (cols && !cols.find(c => c.name === 'sort_order'))
            rawDb.run(`ALTER TABLE pc_status ADD COLUMN sort_order INTEGER DEFAULT 999`);
        if (cols && !cols.find(c => c.name === 'mac_address'))
            rawDb.run(`ALTER TABLE pc_status ADD COLUMN mac_address TEXT`);
        if (cols && !cols.find(c => c.name === 'pos_x'))
            rawDb.run(`ALTER TABLE pc_status ADD COLUMN pos_x REAL`);
        if (cols && !cols.find(c => c.name === 'pos_y'))
            rawDb.run(`ALTER TABLE pc_status ADD COLUMN pos_y REAL`);
    });

    rawDb.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        user TEXT,
        activity_type TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT,
        password_hash TEXT,
        role TEXT DEFAULT 'viewer',
        failed_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration: add columns if not exist (safe for existing DBs)
    rawDb.all(`PRAGMA table_info(users)`, (err, columns) => {
        if (!columns) return;
        const colNames = columns.map(c => c.name);
        if (!colNames.includes('password_hash'))
            rawDb.run(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
        if (!colNames.includes('failed_attempts'))
            rawDb.run(`ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0`);
        if (!colNames.includes('locked_until'))
            rawDb.run(`ALTER TABLE users ADD COLUMN locked_until DATETIME`);
    });

    rawDb.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', ?, 'admin')`,
        [config.DEFAULT_ADMIN_PASSWORD], async function () {
            rawDb.get(`SELECT id, password, password_hash FROM users WHERE username = 'admin'`, async (err, user) => {
                if (user && !user.password_hash && user.password) {
                    try {
                        const hash = await bcrypt.hash(user.password, config.SALT_ROUNDS);
                        rawDb.run(`UPDATE users SET password_hash = ?, password = NULL WHERE id = ?`, [hash, user.id]);
                        logger.info('✅ Admin password hashed successfully');
                    } catch (e) {
                        logger.error('Failed to hash admin password:', e);
                    }
                }
            });
        });

    rawDb.run(`CREATE TABLE IF NOT EXISTS pc_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        policy TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        filename TEXT,
        filepath TEXT,
        file_size INTEGER DEFAULT 0,
        reason TEXT DEFAULT 'manual',
        program TEXT,
        captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Migration: add columns to existing tables
    rawDb.all(`PRAGMA table_info(screenshots)`, (err, cols) => {
        if (!cols) return;
        if (!cols.find(c => c.name === 'file_size'))
            rawDb.run(`ALTER TABLE screenshots ADD COLUMN file_size INTEGER DEFAULT 0`);
        if (!cols.find(c => c.name === 'reason'))
            rawDb.run(`ALTER TABLE screenshots ADD COLUMN reason TEXT DEFAULT 'manual'`);
        if (!cols.find(c => c.name === 'program'))
            rawDb.run(`ALTER TABLE screenshots ADD COLUMN program TEXT`);
    });

    rawDb.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        date TEXT NOT NULL,
        first_login DATETIME,
        last_logout DATETIME,
        UNIQUE(pc_name, date)
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS blocked_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    rawDb.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES ('youtube.com')`);
    rawDb.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES ('twitch.tv')`)

    rawDb.run(`CREATE TABLE IF NOT EXISTS blocked_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        program_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pc_name, program_name)
    )`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_blocked_programs_pc ON blocked_programs(pc_name)`);;

    // Schedule rules: time-based auto block/unblock
    // Each rule: HH:MM start, HH:MM end, weekday bitmask (Sun=1..Sat=64), action, target
    rawDb.run(`CREATE TABLE IF NOT EXISTS schedule_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        weekdays INTEGER NOT NULL DEFAULT 127,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Deployment tokens — for one-click PowerShell install without USB
    rawDb.run(`CREATE TABLE IF NOT EXISTS deployment_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        label TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0
    )`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_deployment_tokens_token ON deployment_tokens(token)`);

    // Registered agents — links agent instance to the token that created it
    rawDb.run(`CREATE TABLE IF NOT EXISTS registered_agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        agent_key TEXT NOT NULL,
        token_id INTEGER,
        status TEXT DEFAULT 'active',
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS saved_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT 'default',
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS remote_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_ip TEXT NOT NULL,
        command TEXT NOT NULL,
        result TEXT,
        status TEXT DEFAULT 'pending',
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    rawDb.run(`CREATE TABLE IF NOT EXISTS pc_reports (
        pc_name TEXT PRIMARY KEY,
        report_data TEXT,
        created_at TEXT
    )`);

    // Phase 15: Audit trail table
    audit.init(rawDb);

    // Performance indexes (Phase 7 + enhanced)
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_pc_status_name ON pc_status(pc_name)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_pc_status_ip ON pc_status(ip_address)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_pc_status_status ON pc_status(status, last_seen)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_pc_status_group ON pc_status(group_id)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_pc ON activity_logs(pc_name, timestamp)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs(timestamp)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(activity_type)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_remote_commands_ip ON remote_commands(target_ip, executed_at)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_remote_commands_status ON remote_commands(status)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_screenshots_pc ON screenshots(pc_name, captured_at)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)`);
    rawDb.run(`CREATE INDEX IF NOT EXISTS idx_blocked_sites_url ON blocked_sites(url)`);

    logger.info('✅ DB optimized: WAL + 12 indexes + 512MB mmap + 16MB cache');
});

// ========================================
// Route Modules
// ========================================
const authRoutes = require('./routes/auth')({ db, bcrypt, generateToken, SALT_ROUNDS: config.SALT_ROUNDS });
const credentialRoutes = require('./routes/credentials')({ db, authenticateToken });
const managementRoutes = require('./routes/management')({ db, io, authenticateToken, pcSockets });
const tokenRoutes = require('./routes/tokens')({ db, authenticateToken, requireRole });

const { encryptPassword, decryptPassword } = credentialRoutes;

const remoteRoutes = require('./routes/remote')({ db, io, exec, authenticateToken, requireRole, decryptPassword });
const deployRoutes = require('./routes/deploy')({ db, io, exec, authenticateToken, requireRole, encryptPassword, decryptPassword, PORT: config.PORT });
const networkRoutes = require('./routes/network')({ db, io, exec, authenticateToken, requireRole, PORT: config.PORT });
const securityRoutes = require('./routes/security')({ db, io, exec, authenticateToken, requireRole });

// Mount all route modules
app.use('/api/auth', authRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api', managementRoutes);
app.use('/api/remote', remoteRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/network', networkRoutes);
app.use('/api', securityRoutes);

// ========================================
// Health Check (Phase 6, enhanced Phase 20)
// ========================================
const startTime = Date.now();

// Classroom auto-token: returns admin token without login (no-auth classroom mode)
// SECURITY: restricted to localhost/admin PC only — students cannot use this
app.get('/api/auth/auto-token', (req, res) => {
    const reqIp = req.ip || req.connection?.remoteAddress || '';
    const isLocal = reqIp === '127.0.0.1' || reqIp === '::1' || reqIp === '::ffff:127.0.0.1';
    if (!isLocal) {
        return res.status(403).json({ success: false, error: 'auto-token은 관리자 PC에서만 사용 가능합니다' });
    }
    const token = generateToken({ id: 0, username: 'admin', role: 'admin' });
    res.json({ success: true, token });
});

// Agent OTA update endpoint (no auth — agents have no token)
app.get('/api/agent-update/agent.js', (req, res) => {
    const agentSrc = path.join(__dirname, '..', 'agent', 'agent.js');
    if (!fs.existsSync(agentSrc)) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.resolve(agentSrc));
});

app.get('/api/health', async (req, res) => {
    const uptimeMs = Date.now() - startTime;
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;

    const dbHealth = await dbWrapper.healthCheck();
    const mem = process.memoryUsage();

    res.json({
        status: dbHealth.status === 'ok' ? 'healthy' : 'degraded',
        version: PKG_VERSION,
        uptime: `${hours}h ${minutes}m ${seconds}s`,
        uptimeMs,
        database: {
            ...dbHealth,
            queries: dbWrapper.metrics(),
        },
        cache: cache.stats(),
        supabase: {
            enabled: mirror.isEnabled,
            queueSize: mirror.queueSize,
            activeSessions: mirror.sessionCount,
        },
        metrics: config.METRICS_ENABLED ? {
            requests: metrics.counters.requests_total,
            errorRate: metrics.counters.requests_total > 0
                ? `${((metrics.counters.requests_error / metrics.counters.requests_total) * 100).toFixed(1)}%`
                : '0%',
        } : 'disabled',
        memory: {
            rss: `${(mem.rss / 1024 / 1024).toFixed(1)}MB`,
            heap: `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
        },
        scheduler: scheduler.status(),
        timestamp: new Date().toISOString(),
    });
});

// ========================================
// Metrics Endpoint (Phase 19)
// ========================================
app.get('/api/metrics', authenticateToken, requireRole('admin'), (req, res) => {
    const format = req.query.format || 'json';
    if (format === 'prometheus') {
        res.setHeader('Content-Type', 'text/plain');
        return res.send(metrics.prometheusText());
    }
    ApiResponse.ok(res, metrics.snapshot());
});

// ========================================
// Audit Log Endpoint (Phase 15)
// ========================================
app.get('/api/audit', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const logs = await audit.query({
            actor: req.query.actor,
            action: req.query.action,
            severity: req.query.severity,
            since: req.query.since,
            limit: parseInt(req.query.limit) || 100,
        });
        ApiResponse.ok(res, logs);
    } catch (err) {
        ApiResponse.serverError(res, 'Failed to query audit logs', err);
    }
});

// ========================================
// API Documentation (Phase 18)
// ========================================
app.get('/api/docs', (req, res) => {
    ApiResponse.ok(res, {
        name: 'Enterprise PC Management API',
        version: PKG_VERSION,
        baseUrl: `/api`,
        endpoints: {
            health: { method: 'GET', path: '/api/health', auth: false },
            metrics: { method: 'GET', path: '/api/metrics', auth: true, role: 'admin' },
            audit: { method: 'GET', path: '/api/audit', auth: true, role: 'admin' },
            docs: { method: 'GET', path: '/api/docs', auth: false },
            auth: {
                login: { method: 'POST', path: '/api/auth/login', auth: false },
            },
            pcs: {
                list: { method: 'GET', path: '/api/pcs', auth: true },
                delete: { method: 'DELETE', path: '/api/pcs/:name', auth: true },
                command: { method: 'POST', path: '/api/pcs/:name/command', auth: false },
                status: { method: 'POST', path: '/api/pcs/:name/status', auth: false },
            },
            logs: { method: 'GET', path: '/api/logs', auth: true },
            stats: { method: 'GET', path: '/api/stats', auth: true },
            credentials: {
                list: { method: 'GET', path: '/api/credentials', auth: true },
                save: { method: 'POST', path: '/api/credentials', auth: true },
                update: { method: 'PUT', path: '/api/credentials/:id', auth: true },
                delete: { method: 'DELETE', path: '/api/credentials/:id', auth: true },
            },
            deploy: {
                deploy: { method: 'POST', path: '/api/deploy', auth: true },
                check: { method: 'GET', path: '/api/deploy/check/:ip', auth: true },
                oneClick: { method: 'POST', path: '/api/deploy/one-click', auth: true },
            },
            network: {
                scan: { method: 'POST', path: '/api/network/scan', auth: true },
                winrm: { method: 'POST', path: '/api/network/setup-winrm', auth: true },
            },
            groups: {
                list: { method: 'GET', path: '/api/groups', auth: false },
                create: { method: 'POST', path: '/api/groups', auth: true },
                assignPc: { method: 'PUT', path: '/api/pcs/:name/group', auth: true },
            },
            security: {
                processKill: { method: 'POST', path: '/api/security/kill-process', auth: true },
                blockProgram: { method: 'POST', path: '/api/security/block-program', auth: true },
            },
            screenshots: {
                list: { method: 'GET', path: '/api/screenshots/:pcName', auth: false },
                save: { method: 'POST', path: '/api/screenshots', auth: false },
            },
            blockedSites: {
                list: { method: 'GET', path: '/api/blocked-sites', auth: false },
                add: { method: 'POST', path: '/api/blocked-sites', auth: false },
                remove: { method: 'DELETE', path: '/api/blocked-sites/:id', auth: false },
            },
        },
    });
});


// ========================================
// Core Inline Routes (with cache + ETag)
// ========================================

app.get('/api/pcs', authenticateToken, cache.etagMiddleware('pcs'), (req, res) => {
    const cached = cache.get('pcs');
    if (cached) {
        metrics.inc('cache_hits');
        return res.json(cached);
    }
    metrics.inc('cache_misses');

    db.all(`SELECT * FROM pc_status ORDER BY pc_name`, (err, rows) => {
        if (err) return ApiResponse.serverError(res, err.message);
        cache.set('pcs', rows, config.CACHE_TTL_PCS);
        res.json(rows);
    });
});

app.delete('/api/pcs/:name', authenticateToken, audit.middleware('pc.delete', 'warning'), (req, res) => {
    const pcName = req.params.name;
    db.run(`DELETE FROM pc_status WHERE pc_name = ? OR ip_address = ?`, [pcName, pcName], function (err) {
        if (err) return ApiResponse.serverError(res, err.message);
        if (this.changes === 0) return ApiResponse.notFound(res, 'PC not found');
        // Clean up all related data
        db.run(`DELETE FROM activity_logs WHERE pc_name = ?`, [pcName]);
        db.run(`DELETE FROM blocked_programs WHERE pc_name = ?`, [pcName]);
        db.run(`DELETE FROM screenshots WHERE pc_name = ?`, [pcName]);
        db.run(`DELETE FROM attendance WHERE pc_name = ?`, [pcName]);
        db.run(`DELETE FROM pc_reports WHERE pc_name = ?`, [pcName]);
        // Disconnect socket if still connected
        const socketId = pcSockets.get(pcName);
        if (socketId) {
            const s = io.sockets.sockets.get(socketId);
            if (s) s.disconnect(true);
            pcSockets.delete(pcName);
        }
        cache.invalidate('pcs');
        cache.invalidate('stats');
        io.emit('pc-deleted', { pcName });
        ApiResponse.ok(res, { message: `PC ${pcName} deleted`, deleted: this.changes });
    });
});

app.post('/api/pcs/:name/command', authenticateToken, requireRole('admin'), (req, res) => {
    const { name } = req.params;
    const { command, params } = req.body;
    io.emit(`command-${name}`, { command, params });
    ApiResponse.ok(res, { message: `Command sent to ${name}` });
});


app.post('/api/pcs/:name/status', optionalAuth, (req, res) => {
    const { name } = req.params;
    const { pcName, ipAddress, cpuUsage, memoryUsage } = req.body;
    const actualPcName = pcName || name;
    db.run(`INSERT INTO pc_status (pc_name, ip_address, cpu_usage, memory_usage, status, last_seen)
            VALUES (?, ?, ?, ?, 'online', datetime('now'))
            ON CONFLICT(pc_name) DO UPDATE SET
                ip_address = excluded.ip_address,
                cpu_usage = excluded.cpu_usage,
                memory_usage = excluded.memory_usage,
                status = 'online',
                last_seen = datetime('now')`,
        [actualPcName, ipAddress, cpuUsage, memoryUsage], (err) => {
            if (err) return ApiResponse.serverError(res, err.message);
            cache.invalidate('pcs');
            cache.invalidate('stats');
            io.emit('pc-updated', { pcName: actualPcName, ipAddress, cpuUsage, memoryUsage });
            ApiResponse.ok(res);
        });
});

app.get('/api/logs', authenticateToken, (req, res) => {
    const { pc_name, limit = 100, page = 1 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 100, 1000);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * parsedLimit;

    let query = 'SELECT * FROM activity_logs';
    let countQuery = 'SELECT COUNT(*) as total FROM activity_logs';
    const params = [];
    const countParams = [];

    if (pc_name) {
        query += ' WHERE pc_name = ?';
        countQuery += ' WHERE pc_name = ?';
        params.push(pc_name);
        countParams.push(pc_name);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parsedLimit, offset);

    db.get(countQuery, countParams, (err, countRow) => {
        db.all(query, params, (err2, rows) => {
            if (err || err2) return ApiResponse.serverError(res, (err || err2).message);
            ApiResponse.paginated(res, rows, {
                page: parseInt(page) || 1,
                limit: parsedLimit,
                total: countRow?.total || 0,
                totalPages: Math.ceil((countRow?.total || 0) / parsedLimit),
            });
        });
    });
});

app.get('/api/stats', authenticateToken, cache.etagMiddleware('stats'), (req, res) => {
    const cached = cache.get('stats');
    if (cached) {
        metrics.inc('cache_hits');
        return res.json(cached);
    }
    metrics.inc('cache_misses');

    const dbGet = (sql) => new Promise((resolve, reject) => {
        db.get(sql, (err, row) => err ? reject(err) : resolve(row));
    });

    Promise.all([
        dbGet('SELECT COUNT(*) as total FROM pc_status'),
        dbGet(`SELECT COUNT(*) as online FROM pc_status WHERE status = 'online' AND datetime(last_seen) > datetime('now', '-5 minutes')`),
        dbGet('SELECT COUNT(*) as activities FROM activity_logs WHERE DATE(timestamp) = DATE("now")'),
        dbGet('SELECT COUNT(*) as commands FROM remote_commands WHERE DATE(executed_at) = DATE("now")'),
        dbGet('SELECT COUNT(*) as blocked FROM blocked_sites'),
    ]).then(([totalRow, onlineRow, activityRow, commandRow, blockedRow]) => {
        const stats = {
            totalPCs: totalRow?.total || 0,
            onlinePCs: onlineRow?.online || 0,
            offlinePCs: (totalRow?.total || 0) - (onlineRow?.online || 0),
            todayActivities: activityRow?.activities || 0,
            todayCommands: commandRow?.commands || 0,
            blockedSites: blockedRow?.blocked || 0,
        };
        cache.set('stats', stats, config.CACHE_TTL_STATS);
        res.json(stats);
    }).catch(err => ApiResponse.serverError(res, err.message));
});

// ========================================
// Per-PC Agent Routes (processes, block-program, send-file)
// ========================================

// GET /api/pcs/:name/processes
// NOTE: /api/recordings endpoints removed per user request ("세션 녹화 없애").
// recordings/ directory kept for existing files; recovery via file manager if needed.

// GET /api/stream-stats — all PCs' streaming telemetry
app.get('/api/stream-stats', authenticateToken, (req, res) => {
    const now = Date.now();
    const stats = {};
    for (const [pcName, s] of _streamStats.entries()) {
        const sinceLastFrame = s.lastFrameAt ? now - s.lastFrameAt : null;
        stats[pcName] = {
            frames: s.frames || 0,
            bytes: s.bytes || 0,
            sinceLastFrameMs: sinceLastFrame,
            agentFps: s.agentFps ?? null,
            agentDrops: s.agentDrops ?? null,
            kbps: s.kbps ?? null,
            mode: s.mode ?? null,
            codec: s.codec ?? null,
            rssMB: s.rssMB ?? null,
            streaming: sinceLastFrame !== null && sinceLastFrame < 10000,
        };
    }
    res.json({ success: true, stats, timestamp: now });
});

// GET /api/pcs/:name/stream-stats — single PC
app.get('/api/pcs/:name/stream-stats', authenticateToken, (req, res) => {
    const s = _streamStats.get(req.params.name);
    if (!s) return res.status(404).json({ success: false, error: 'No stream data' });
    const now = Date.now();
    res.json({
        success: true,
        stats: { ...s, sinceLastFrameMs: s.lastFrameAt ? now - s.lastFrameAt : null },
    });
});

// Stream stall sweeper: every 15s, detect PCs that stopped streaming while viewers watching
setInterval(() => {
    const now = Date.now();
    for (const [pcName, s] of _streamStats.entries()) {
        const streamRoom = io.sockets.adapter.rooms.get(`stream-${pcName}`);
        const cctvRoom = io.sockets.adapter.rooms.get('cctv-room');
        const viewerCount = (streamRoom?.size || 0) + (cctvRoom?.size || 0);
        if (viewerCount === 0) continue;
        const sinceLastFrame = s.lastFrameAt ? now - s.lastFrameAt : Infinity;
        const alertState = _streamAlertState.get(pcName);
        if (sinceLastFrame > 15000) {
            if (!alertState || (now - alertState.alertedAt) > 60000) {
                const socketId = pcSockets.get(pcName);
                if (socketId) {
                    const pcSocket = io.sockets.sockets.get(socketId);
                    if (pcSocket) {
                        logger.warn(`Stream stall: ${pcName} (${Math.round(sinceLastFrame/1000)}s) — nudging restart`);
                        pcSocket.emit(`stop-stream-${pcName}`);
                        setTimeout(() => {
                            const fps = cctvRoom?.size > 0 ? 3 : 15;
                            const quality = cctvRoom?.size > 0 ? 30 : 80;
                            pcSocket.emit(`start-stream-${pcName}`, { fps, quality, mode: cctvRoom?.size > 0 ? 'cctv' : null });
                        }, 1500);
                    }
                }
                _streamAlertState.set(pcName, { alertedAt: now });
                io.emit('stream-stall', { pcName, sinceLastFrame, at: now });
            }
        } else if (alertState) {
            _streamAlertState.delete(pcName);
        }
    }
}, 15000);

// GET /api/pcs/:name/monitors — list connected displays on target PC
app.get('/api/pcs/:name/monitors', authenticateToken, (req, res) => {
    const name = req.params.name;
    const socketId = pcSockets.get(name);
    if (!socketId) return res.status(404).json({ success: false, error: 'PC not connected' });
    const pcSocket = io.sockets.sockets.get(socketId);
    if (!pcSocket) return res.status(404).json({ success: false, error: 'Socket gone' });
    const timer = setTimeout(() => {
        if (!res.headersSent) res.status(504).json({ success: false, error: 'Monitor list timeout' });
    }, 5000);
    pcSocket.emit(`get-monitors-${name}`, (data) => {
        clearTimeout(timer);
        if (res.headersSent) return;
        res.json({ success: true, monitors: data?.monitors || [] });
    });
});

app.get('/api/pcs/:name/processes', authenticateToken, (req, res) => {
    const name = req.params.name;
    const socketId = pcSockets.get(name);
    if (!socketId) return res.status(404).json({ success: false, error: 'PC not connected' });
    const pcSocket = io.sockets.sockets.get(socketId);
    if (!pcSocket) { pcSockets.delete(name); return res.status(404).json({ success: false, error: 'Socket gone' }); }

    const timer = setTimeout(() => {
        if (!res.headersSent) res.status(504).json({ success: false, error: 'Process list timeout — PC may be busy' });
    }, 15000);

    pcSocket.emit(`get-processes-${name}`, (data) => {
        clearTimeout(timer);
        if (res.headersSent) return;
        res.json({ success: true, processes: data?.processes || [] });
    });
});

// GET /api/pcs/:name/apps — running apps (windowed processes only)
app.get('/api/pcs/:name/apps', authenticateToken, (req, res) => {
    const name = req.params.name;
    const socketId = pcSockets.get(name);
    if (!socketId) return res.status(404).json({ success: false, error: 'PC not connected' });
    const pcSocket = io.sockets.sockets.get(socketId);
    if (!pcSocket) { pcSockets.delete(name); return res.status(404).json({ success: false, error: 'Socket gone' }); }

    const timer = setTimeout(() => {
        if (!res.headersSent) res.status(504).json({ success: false, error: 'Timeout' });
    }, 15000);

    pcSocket.emit(`get-apps-${name}`, (data) => {
        clearTimeout(timer);
        if (res.headersSent) return;
        res.json({ success: true, apps: data?.apps || [] });
    });
});

// PATCH /api/pcs/:name/rename — set display name
app.patch('/api/pcs/:name/rename', authenticateToken, requireRole('admin'), (req, res) => {
    const pcName = req.params.name;
    const { displayName } = req.body;
    if (displayName === undefined) return res.status(400).json({ error: 'displayName required' });
    const safeName = (displayName || '').substring(0, 50).trim();
    db.run(`UPDATE pc_status SET display_name = ? WHERE pc_name = ?`,
        [safeName || null, pcName], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'PC not found' });
            cache.invalidate('pcs');
            io.emit('pc-updated', { pcName, displayName: safeName || null });
            res.json({ success: true });
        });
});

// PATCH /api/pcs/reorder — save card drag order
app.patch('/api/pcs/reorder', authenticateToken, requireRole('admin'), (req, res) => {
    const { order } = req.body; // [ { pcName: "PC1", sortOrder: 0 }, ... ]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

    const stmt = db.prepare(`UPDATE pc_status SET sort_order = ? WHERE pc_name = ?`);
    let errors = 0;
    order.forEach(({ pcName, sortOrder }) => {
        if (pcName && typeof sortOrder === 'number') {
            stmt.run([sortOrder, pcName], (err) => { if (err) errors++; });
        }
    });
    stmt.finalize((err) => {
        if (err || errors) return ApiResponse.serverError(res, 'Some updates failed');
        cache.invalidate('pcs');
        ApiResponse.ok(res, { message: `Reordered ${order.length} PCs` });
    });
});

// PATCH /api/pcs/:name/position — save free-form card position
app.patch('/api/pcs/:name/position', authenticateToken, requireRole('admin'), (req, res) => {
    const { x, y } = req.body;
    const pcName = req.params.name;
    if (typeof x !== 'number' || typeof y !== 'number') return res.status(400).json({ error: 'x, y required' });
    db.run(`UPDATE pc_status SET pos_x = ?, pos_y = ? WHERE pc_name = ?`, [x, y, pcName], function(err) {
        if (err) return ApiResponse.serverError(res, err.message);
        cache.invalidate('pcs');
        ApiResponse.ok(res, { pcName, x, y });
    });
});

// POST /api/wallpaper-lock — toggle wallpaper lock on all online PCs
app.post('/api/wallpaper-lock', authenticateToken, requireRole('admin'), (req, res) => {
    const { locked } = req.body;
    const state = !!locked;

    // Send to all connected agents
    let sent = 0;
    pcSockets.forEach((socketId, pcName) => {
        const pcSocket = io.sockets.sockets.get(socketId);
        if (pcSocket) {
            pcSocket.emit(`wallpaper-lock-${pcName}`, { locked: state });
            logger.info(`Wallpaper lock sent to ${pcName} (socket ${socketId})`);
            sent++;
        } else {
            logger.warn(`Wallpaper lock: socket not found for ${pcName} (${socketId})`);
        }
    });
    logger.info(`Wallpaper lock: sent to ${sent}/${pcSockets.size} agents`);

    // Persist to DB + memory
    global._wallpaperLocked = state;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('wallpaper_locked', ?)`, [state ? '1' : '0']);
    logger.info(`Wallpaper lock ${state ? 'ON' : 'OFF'} for all PCs`);
    ApiResponse.ok(res, { locked: state, pcCount: pcSockets.size });
});

// ── WOL helper: send magic packet 3x to subnet broadcast ──
function sendWOL(macAddress) {
    return new Promise((resolve, reject) => {
        const mac = macAddress.replace(/[:-]/g, '');
        if (mac.length !== 12) return reject(new Error('Invalid MAC'));
        const macBuf = Buffer.from(mac, 'hex');
        const magic = Buffer.alloc(102);
        magic.fill(0xFF, 0, 6);
        for (let i = 0; i < 16; i++) macBuf.copy(magic, 6 + i * 6);

        const dgram = require('dgram');
        const sock = dgram.createSocket('udp4');
        sock.once('listening', () => sock.setBroadcast(true));

        let sent = 0;
        const sendOne = () => {
            sock.send(magic, 0, magic.length, 9, '192.168.0.255', (err) => {
                if (err) { sock.close(); return reject(err); }
                sent++;
                if (sent < 3) setTimeout(sendOne, 300);
                else { sock.close(); resolve({ mac: macAddress, sent }); }
            });
        };
        sendOne();
    });
}

// ── Ping helper (non-blocking, 1s timeout) ──
function pingHost(ip, timeoutMs = 1000) {
    if (!ip || !isValidIP(ip)) return Promise.resolve(false);
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs + 500);
        exec(`ping -n 1 -w ${timeoutMs} ${ip}`, { timeout: timeoutMs + 1000 }, (err, stdout) => {
            clearTimeout(timer);
            resolve(!err && (stdout || '').includes('TTL='));
        });
    });
}

// POST /api/wol/:name — Wake-on-LAN: send magic packet to power on a PC
app.post('/api/wol/:name', authenticateToken, requireRole('admin'), async (req, res) => {
    const pcName = req.params.name;
    db.get('SELECT mac_address FROM pc_status WHERE pc_name = ?', [pcName], async (err, row) => {
        if (err) return ApiResponse.serverError(res, err.message);
        if (!row || !row.mac_address) return res.status(404).json({ error: 'MAC address not found' });
        try {
            const result = await sendWOL(row.mac_address);
            logger.info(`WOL sent to ${pcName} (${row.mac_address}) x3`);
            ApiResponse.ok(res, { pcName, mac: row.mac_address, sent: result.sent });
        } catch (e) {
            ApiResponse.serverError(res, e.message);
        }
    });
});

// POST /api/wol-all — Wake ALL offline PCs
app.post('/api/wol-all', authenticateToken, requireRole('admin'), (req, res) => {
    db.all('SELECT pc_name, mac_address, ip_address FROM pc_status WHERE mac_address IS NOT NULL', async (err, rows) => {
        if (err) return ApiResponse.serverError(res, err.message);
        const targets = (rows || []).filter(r => r.mac_address && !pcSockets.has(r.pc_name));
        let sent = 0;
        for (const t of targets) {
            try { await sendWOL(t.mac_address); sent++; } catch (e) { /* skip */ }
        }
        logger.info(`WOL-ALL: ${sent}/${targets.length} offline PCs`);
        ApiResponse.ok(res, { sent, total: targets.length });
    });
});

// POST /api/boot-sequence — Full boot sequence: WOL → wait → verify → retry
let _bootSequenceRunning = false;
// _recordings Map removed — session recording deprecated.
// Per-PC streaming telemetry: ingress frame count/bytes + agent-reported fps/drops/kbps
const _streamStats = new Map(); // pcName → { frames, bytes, lastFrameAt, agentFps, agentDrops, kbps, lastStatsAt }
const _streamAlertState = new Map(); // pcName → { alertedAt } — to avoid alert spam
const _streamModeByPc = new Map(); // pcName → { fps, quality, mode, monitor } — remembered for register-pc auto-resume
app.post('/api/boot-sequence', authenticateToken, requireRole('admin'), (req, res) => {
    if (_bootSequenceRunning) return res.status(409).json({ success: false, error: 'Boot sequence already running' });
    _bootSequenceRunning = true;
    db.all('SELECT pc_name, mac_address, ip_address FROM pc_status WHERE mac_address IS NOT NULL', async (err, rows) => {
        if (err) return ApiResponse.serverError(res, err.message);
        const targets = (rows || []).filter(r => r.mac_address && r.ip_address && r.ip_address !== '127.0.0.1');
        const results = {};

        // Phase 1: WOL all
        for (const t of targets) {
            try { await sendWOL(t.mac_address); results[t.pc_name] = { phase: 1, status: 'wol-sent' }; }
            catch (e) { results[t.pc_name] = { phase: 1, status: 'wol-failed', error: e.message }; }
        }
        // Send early response — boot continues in background
        ApiResponse.ok(res, { message: 'Boot sequence started', targets: targets.length, results });
        io.emit('new-activity', { pc_name: 'SYSTEM', activity_type: 'boot-sequence', details: `${targets.length}대 전체 부팅 시작`, timestamp: new Date().toISOString() });

        // Phase 2: Wait 45s then check (all pings in parallel)
        await new Promise(r => setTimeout(r, 45000));
        const pingResults = await Promise.all(targets.map(t => pingHost(t.ip_address)));
        const failed = [];
        targets.forEach((t, i) => {
            if (pingResults[i]) { results[t.pc_name] = { phase: 2, status: 'booted' }; }
            else { failed.push(t); results[t.pc_name] = { phase: 2, status: 'no-ping' }; }
        });

        // Phase 3: Retry failed (parallel WOL + parallel ping)
        if (failed.length > 0) {
            await Promise.all(failed.map(t => sendWOL(t.mac_address).catch(() => {})));
            await new Promise(r => setTimeout(r, 30000));
            const retryPings = await Promise.all(failed.map(t => pingHost(t.ip_address)));
            failed.forEach((t, i) => {
                results[t.pc_name] = { phase: 3, status: retryPings[i] ? 'booted-retry' : 'failed' };
            });
        }

        const booted = Object.values(results).filter(r => r.status.startsWith('booted')).length;
        const failedCount = Object.values(results).filter(r => r.status === 'failed').length;
        logger.info(`Boot sequence done: ${booted}/${targets.length} booted, ${failedCount} failed`);
        io.emit('new-activity', { pc_name: 'SYSTEM', activity_type: 'boot-sequence', details: `부팅 완료: ${booted}/${targets.length}대 성공`, timestamp: new Date().toISOString() });
        _bootSequenceRunning = false;
    });
});

// GET /api/ping-sweep — check which PCs respond to ping (agent-independent)
app.get('/api/ping-sweep', authenticateToken, async (req, res) => {
    db.all('SELECT pc_name, ip_address, mac_address, status FROM pc_status', async (err, rows) => {
        if (err) return ApiResponse.serverError(res, err.message);
        const results = await Promise.all((rows || []).filter(r => r.ip_address && r.ip_address !== '127.0.0.1').map(async (r) => {
            const pingOk = await pingHost(r.ip_address);
            const agentOk = pcSockets.has(r.pc_name);
            let state;
            if (agentOk) state = 'online';
            else if (pingOk) state = 'pc-on-agent-dead';
            else state = 'pc-off';
            return { pcName: r.pc_name, ip: r.ip_address, ping: pingOk, agent: agentOk, state };
        }));
        ApiResponse.ok(res, results);
    });
});

// POST /api/wake-offline — relay schtasks via online PC to revive offline agents
// This is a classroom management feature: uses one online student PC to trigger
// the registered scheduled task on offline PCs within the same local network.
// IP addresses come from the DB (previously registered PCs), not user input.
app.post('/api/wake-offline', authenticateToken, requireRole('admin'), (req, res) => {
    const offlineIPs = [];
    const onlineSockets = [];
    db.all('SELECT pc_name, ip_address, status FROM pc_status', (err, rows) => {
        if (err || !rows) return ApiResponse.serverError(res, 'DB error');
        rows.forEach(r => {
            if (r.status !== 'online' && r.ip_address && r.ip_address !== '127.0.0.1' && isValidIP(r.ip_address)) {
                offlineIPs.push(r.ip_address);
            }
        });
        pcSockets.forEach((socketId, pcName) => {
            const s = io.sockets.sockets.get(socketId);
            if (s) onlineSockets.push({ pcName, socket: s });
        });
        if (onlineSockets.length === 0 || offlineIPs.length === 0) {
            return ApiResponse.ok(res, { woke: 0 });
        }
        const relay = onlineSockets[0];
        const cmds = offlineIPs.map(ip =>
            `schtasks /run /s ${ip} /tn PCManagementAgent 2>nul`
        ).join(' & ');
        relay.socket.emit(`command-${relay.pcName}`, { command: 'run', params: { cmd: cmds } });
        logger.info(`Wake-offline: ${offlineIPs.length} IPs via ${relay.pcName}`);
        ApiResponse.ok(res, { woke: offlineIPs.length, relay: relay.pcName });
    });
});

// POST /api/wallpaper-apply — run wallpaper-push.js script
// POST /api/wallpaper-apply — enable wallpaper lock and broadcast to all agents
// No more subprocess: use the built-in agent wallpaper-lock mechanism directly.
// Agent downloads wallpaper.png from /wallpaper.png, applies, then polls to enforce.
app.post('/api/wallpaper-apply', authenticateToken, requireRole('admin'), (req, res) => {
    global._wallpaperLocked = true;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('wallpaper_locked', '1')`);

    let sent = 0;
    pcSockets.forEach((socketId, pcName) => {
        const pcSocket = io.sockets.sockets.get(socketId);
        if (pcSocket) {
            pcSocket.emit(`wallpaper-lock-${pcName}`, { locked: true });
            sent++;
        }
    });
    logger.info(`Wallpaper lock broadcast to ${sent}/${pcSockets.size} agents`);
    ApiResponse.ok(res, { sent, total: pcSockets.size });
});

// POST /api/exam-mode — one-click exam lockdown
// Blocks all programs except whitelist, sends message, locks wallpaper
app.post('/api/exam-mode', authenticateToken, requireRole('admin'), (req, res) => {
    const { enabled, whitelist = [], message = '' } = req.body;
    global._examMode = !!enabled;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('exam_mode', ?)`, [enabled ? '1' : '0']);

    let sent = 0;
    pcSockets.forEach((socketId, pcName) => {
        const pcSocket = io.sockets.sockets.get(socketId);
        if (pcSocket) {
            pcSocket.emit(`exam-mode-${pcName}`, {
                enabled: !!enabled,
                whitelist,
                message: message || (enabled ? '시험 모드가 시작되었습니다.' : '시험 모드가 종료되었습니다.'),
            });
            sent++;
        }
    });
    logger.info(`Exam mode ${enabled ? 'ON' : 'OFF'} broadcast to ${sent}/${pcSockets.size} agents`);
    io.emit('new-activity', {
        pc_name: 'SYSTEM',
        activity_type: 'exam-mode',
        details: enabled ? '시험 모드 시작' : '시험 모드 종료',
        timestamp: new Date().toISOString(),
    });
    ApiResponse.ok(res, { examMode: !!enabled, sent, total: pcSockets.size });
});

// POST /api/agent-update — push latest agent.js to all connected PCs via 'run' command
// Admin triggers rolling auto-update. Simply emits force-update to all connected
// agents — they use their built-in checkForUpdate() with SHA256 verification,
// atomic file replace, and automatic restart. Safer than the old bitsadmin hack.
app.post('/api/agent-update', authenticateToken, requireRole('admin'), (req, res) => {
    let sent = 0;
    pcSockets.forEach((socketId, pcName) => {
        const pcSocket = io.sockets.sockets.get(socketId);
        if (pcSocket) {
            pcSocket.emit(`force-update-${pcName}`, { timestamp: Date.now() });
            logger.info(`Force-update signal sent to ${pcName}`);
            sent++;
        }
    });
    ApiResponse.ok(res, { sent, total: pcSockets.size, method: 'force-update' });
});

// GET /api/license-info — show license details
app.get('/api/license-info', authenticateToken, (req, res) => {
    ApiResponse.ok(res, {
        academy: licenseInfo.academy,
        maxPCs: licenseInfo.maxPCs,
        expiry: licenseInfo.expiry,
        edition: licenseInfo.edition,
        currentPCs: pcSockets.size,
    });
});

// Auto-sync: copy dashboard/agent/agent.js → frontend/agent-latest.js on startup
// and whenever it changes. This guarantees agents always get the canonical version.
(function setupAgentAutoSync() {
    const srcPath = path.join(__dirname, '..', 'agent', 'agent.js');
    const dstPath = path.join(__dirname, '..', 'frontend', 'agent-latest.js');
    const crypto = require('crypto');

    function syncAgent() {
        try {
            if (!fs.existsSync(srcPath)) return;
            const src = fs.readFileSync(srcPath);
            if (fs.existsSync(dstPath)) {
                const dst = fs.readFileSync(dstPath);
                if (src.equals(dst)) return; // no change
            }
            fs.writeFileSync(dstPath, src);
            const hash = crypto.createHash('sha256').update(src).digest('hex');
            logger.info(`Agent auto-sync: agent.js → agent-latest.js (sha256=${hash.slice(0, 16)})`);
        } catch (e) {
            logger.warn('Agent auto-sync error: ' + e.message);
        }
    }

    syncAgent();
    try {
        fs.watch(path.dirname(srcPath), { persistent: false }, (evt, file) => {
            if (file === 'agent.js') setTimeout(syncAgent, 500);
        });
    } catch (e) {
        // fs.watch may not work on all filesystems; fall back to polling
        setInterval(syncAgent, 30000);
    }
})();

// GET /api/agent-version — returns latest version + sha256 + download URL
// Cached to avoid reading 80KB file on every 10-minute poll from every agent
let _agentVersionCache = null;
app.get('/api/agent-version', (req, res) => {
    if (_agentVersionCache) return res.json(_agentVersionCache);
    const agentPath = path.join(__dirname, '..', 'frontend', 'agent-latest.js');
    let version = '0', sha256 = '', size = 0;
    if (fs.existsSync(agentPath)) {
        const content = fs.readFileSync(agentPath);
        const match = content.toString('utf-8').match(/AGENT_VERSION:\s*'([^']+)'/);
        if (match) version = match[1];
        sha256 = require('crypto').createHash('sha256').update(content).digest('hex');
        size = content.length;
    }
    _agentVersionCache = { version, sha256, size, url: '/agent-latest.js' };
    // Invalidate cache after 60s (picks up new deployments)
    setTimeout(() => { _agentVersionCache = null; }, 60000);
    res.json(_agentVersionCache);
});

// GET /api/wallpaper-lock — get current state (from DB)
app.get('/api/wallpaper-lock', authenticateToken, (req, res) => {
    ApiResponse.ok(res, { locked: !!global._wallpaperLocked });
});

// GET /api/exam-mode — get current exam mode state
app.get('/api/exam-mode', authenticateToken, (req, res) => {
    ApiResponse.ok(res, { enabled: !!global._examMode });
});

// Restore wallpaper lock state from DB on startup
db.get(`SELECT value FROM settings WHERE key = 'wallpaper_locked'`, (err, row) => {
    if (row && row.value === '1') {
        global._wallpaperLocked = true;
        logger.info('Wallpaper lock restored from DB: ON');
    }
});
// Restore exam mode state from DB on startup
db.get(`SELECT value FROM settings WHERE key = 'exam_mode'`, (err, row) => {
    if (row && row.value === '1') {
        global._examMode = true;
        logger.info('Exam mode restored from DB: ON');
    }
});

// POST /api/pcs/:name/kill-process
app.post('/api/pcs/:name/kill-process', authenticateToken, requireRole('admin'), (req, res) => {
    const name = req.params.name;
    const { processName } = req.body;
    if (!processName) return res.status(400).json({ error: 'processName required' });
    io.emit(`command-${name}`, { command: 'kill-process', params: { processName } });
    ApiResponse.ok(res, { message: `Kill ${processName} sent to ${name}` });
});

// Helper: send full blocked-programs sync to a single agent.
// '*' is a reserved pc_name meaning "apply to every PC".
function syncBlockedProgramsTo(pcName) {
    const sid = pcSockets.get(pcName);
    if (!sid) return;
    const s = io.sockets.sockets.get(sid);
    if (!s) return;
    db.all("SELECT DISTINCT program_name FROM blocked_programs WHERE pc_name = ? OR pc_name = '*'",
        [pcName], (err, rows) => {
            const programs = (rows || []).map(r => r.program_name).filter(Boolean);
            s.emit(`sync-blocked-programs-${pcName}`, { programs });
        });
}

// Helper: broadcast full blocked-programs sync to every connected agent
function syncBlockedProgramsToAll() {
    pcSockets.forEach((sid, pcName) => syncBlockedProgramsTo(pcName));
}

// POST /api/pcs/:name/block-program
app.post('/api/pcs/:name/block-program', authenticateToken, requireRole('admin'), (req, res) => {
    const name = req.params.name;
    const { programName, blocked } = req.body;
    if (!programName) return res.status(400).json({ error: 'programName required' });
    const prog = programName.toLowerCase().trim();
    if (blocked !== false) {
        db.run('INSERT OR IGNORE INTO blocked_programs (pc_name, program_name) VALUES (?, ?)',
            [name, prog], (err) => {
                if (err) return ApiResponse.serverError(res, err.message);
                syncBlockedProgramsTo(name);
                ApiResponse.ok(res, { message: `${prog} blocked on ${name}` });
            });
    } else {
        db.run('DELETE FROM blocked_programs WHERE pc_name = ? AND program_name = ?',
            [name, prog], (err) => {
                if (err) return ApiResponse.serverError(res, err.message);
                syncBlockedProgramsTo(name);
                ApiResponse.ok(res, { message: `${prog} unblocked on ${name}` });
            });
    }
});

// ════════════════════════════════════════════
// Config export/import — backup & migration
// ════════════════════════════════════════════
// Export: full system state except secrets (license, integration keys).
// Import: replace current state with uploaded JSON. Atomic via transaction.

app.get('/api/config/export', authenticateToken, requireRole('admin'), async (req, res) => {
    const readTable = (sql) => new Promise(r => db.all(sql, (err, rows) => r(err ? [] : (rows || []))));
    try {
        const [sites, programs, rules, groups] = await Promise.all([
            readTable('SELECT url FROM blocked_sites ORDER BY url'),
            readTable('SELECT DISTINCT pc_name, program_name FROM blocked_programs'),
            readTable('SELECT name, start_time, end_time, weekdays, action, target, enabled FROM schedule_rules'),
            readTable('SELECT name, description, policy FROM pc_groups'),
        ]);
        res.json({
            exportedAt: new Date().toISOString(),
            version: PKG_VERSION,
            academy: licenseInfo.academy,
            blockedSites: sites.map(s => s.url),
            blockedPrograms: programs,
            scheduleRules: rules,
            pcGroups: groups,
        });
    } catch (e) {
        ApiResponse.serverError(res, e.message);
    }
});

app.post('/api/config/import', authenticateToken, requireRole('admin'), (req, res) => {
    const cfg = req.body || {};
    const replace = !!cfg.replace;
    const counts = { sites: 0, programs: 0, rules: 0 };

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        if (replace) {
            db.run('DELETE FROM blocked_sites');
            db.run('DELETE FROM blocked_programs');
            db.run('DELETE FROM schedule_rules');
        }

        if (Array.isArray(cfg.blockedSites)) {
            const stmt = db.prepare('INSERT OR IGNORE INTO blocked_sites (url) VALUES (?)');
            cfg.blockedSites.forEach(u => {
                if (typeof u === 'string' && /^[\w.-]+\.[\w.-]+$/.test(u)) {
                    stmt.run(u.toLowerCase());
                    counts.sites++;
                }
            });
            stmt.finalize();
        }

        if (Array.isArray(cfg.blockedPrograms)) {
            const stmt = db.prepare("INSERT OR IGNORE INTO blocked_programs (pc_name, program_name) VALUES (?, ?)");
            cfg.blockedPrograms.forEach(p => {
                if (p && typeof p.program_name === 'string') {
                    stmt.run(p.pc_name || '*', p.program_name.toLowerCase());
                    counts.programs++;
                }
            });
            stmt.finalize();
        }

        if (Array.isArray(cfg.scheduleRules)) {
            const stmt = db.prepare(`INSERT INTO schedule_rules (name, start_time, end_time, weekdays, action, target, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            cfg.scheduleRules.forEach(r => {
                if (!r.name || !r.start_time || !r.end_time || !r.action || !r.target) return;
                if (!/^\d{2}:\d{2}$/.test(r.start_time) || !/^\d{2}:\d{2}$/.test(r.end_time)) return;
                if (!['block-program', 'unblock-program'].includes(r.action)) return;
                stmt.run(r.name, r.start_time, r.end_time, r.weekdays || 127, r.action, r.target, r.enabled ? 1 : 0);
                counts.rules++;
            });
            stmt.finalize();
        }

        db.run('COMMIT', (err) => {
            if (err) {
                db.run('ROLLBACK');
                return ApiResponse.serverError(res, err.message);
            }
            // Broadcast new state to all agents
            pcSockets.forEach((sid, pcName) => {
                const s = io.sockets.sockets.get(sid);
                if (!s) return;
                db.all('SELECT url FROM blocked_sites ORDER BY url', (_e, rows) => {
                    s.emit(`sync-blocked-sites-${pcName}`, { domains: (rows || []).map(r => r.url) });
                });
                db.all("SELECT DISTINCT program_name FROM blocked_programs WHERE pc_name = ? OR pc_name = '*'", [pcName], (_e, rows) => {
                    s.emit(`sync-blocked-programs-${pcName}`, { programs: (rows || []).map(r => r.program_name) });
                });
            });
            ApiResponse.ok(res, { imported: counts, replaced: replace });
        });
    });
});

// ════════════════════════════════════════════
// /install/:token — one-click PowerShell installer
// ════════════════════════════════════════════
// Usage on student PC (admin PowerShell):
//   irm http://192.168.0.5:3001/install/<token> | iex
//
// Returns a PowerShell script that:
//   1. Validates the token via /api/tokens/validate
//   2. Downloads agent.js + ffmpeg.exe + node.exe
//   3. Installs to C:\PCAgent
//   4. Registers autostart + starts the agent
//
// Token validation is tracked so each token has max_uses limit.
app.get('/install/:token', (req, res) => {
    const token = req.params.token;
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).send('# Invalid token format');
    }
    const serverHost = (req.headers.host || `localhost:${config.PORT}`);
    const serverUrl = `http://${serverHost}`;
    // PowerShell script — plain text, no special escaping needed
    // since we control the template (token is validated above).
    const ps = `# JHS PC Agent — One-Click Installer
# Server: ${serverUrl}
$ErrorActionPreference = 'Stop'
Write-Host "JHS PC Agent Installer" -ForegroundColor Cyan
Write-Host "Server: ${serverUrl}" -ForegroundColor Gray

# 0. Admin check
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: Run as Administrator" -ForegroundColor Red
    exit 1
}

# 1. Validate token
$pcName = $env:COMPUTERNAME
$ipv4 = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual | Select-Object -First 1).IPAddress
Write-Host "[1/6] Validating token..." -ForegroundColor Yellow
$validate = Invoke-RestMethod -Uri "${serverUrl}/api/tokens/validate" -Method Post -ContentType "application/json" -Body (@{token='${token}';pcName=$pcName;ipAddress=$ipv4}|ConvertTo-Json)
if (-not $validate.success) { Write-Host "Token validation failed: $($validate.error)" -ForegroundColor Red; exit 1 }
Write-Host "       Token OK, agentKey assigned" -ForegroundColor Green

# 2. Kill existing agent
Write-Host "[2/6] Stopping existing agent..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\\PCAgent\\*' } | Stop-Process -Force
schtasks /delete /tn PCAgent /f 2>$null | Out-Null
schtasks /delete /tn PCAgent_Watchdog /f 2>$null | Out-Null
Write-Host "       OK" -ForegroundColor Green

# 3. Prepare directory
Write-Host "[3/6] Preparing C:\\PCAgent..." -ForegroundColor Yellow
if (Test-Path "C:\\PCAgent") { Remove-Item "C:\\PCAgent" -Recurse -Force }
New-Item -Path "C:\\PCAgent" -ItemType Directory -Force | Out-Null
Write-Host "       OK" -ForegroundColor Green

# 4. Download agent bundle
Write-Host "[4/6] Downloading agent (this may take a minute)..." -ForegroundColor Yellow
$files = @{
    'agent.js' = "${serverUrl}/agent-latest.js"
    'package.json' = "${serverUrl}/install-assets/package.json"
    '.env' = "${serverUrl}/install-assets/env-template"
}
foreach ($name in $files.Keys) {
    try {
        Invoke-WebRequest -Uri $files[$name] -OutFile "C:\\PCAgent\\$name" -UseBasicParsing
    } catch { Write-Host "       Download skipped: $name — $($_.Exception.Message)" -ForegroundColor DarkGray }
}
# node.exe + ffmpeg.exe come from the server's build-out (too large to bundle, use BITS)
Write-Host "       Core files downloaded" -ForegroundColor Green

# 5. Write launchers
Write-Host "[5/6] Writing launcher scripts..." -ForegroundColor Yellow
@"
@echo off
:LOOP
cd /d "C:\\PCAgent"
set SERVER_URL=${serverUrl}
"C:\\Program Files\\nodejs\\node.exe" agent.js
ping -n 6 127.0.0.1 >NUL
goto LOOP
"@ | Out-File -FilePath "C:\\PCAgent\\autostart.bat" -Encoding ASCII
@"
Set ws = CreateObject("WScript.Shell")
ws.Run """C:\\PCAgent\\autostart.bat""", 0, False
"@ | Out-File -FilePath "C:\\PCAgent\\start-hidden.vbs" -Encoding ASCII
"SERVER_URL=${serverUrl}" | Out-File -FilePath "C:\\PCAgent\\.env" -Encoding ASCII
Write-Host "       OK" -ForegroundColor Green

# 6. Register autostart + start now
Write-Host "[6/6] Registering autostart + starting agent..." -ForegroundColor Yellow
schtasks /create /tn PCAgent /tr 'wscript.exe "C:\\PCAgent\\start-hidden.vbs"' /sc onlogon /rl highest /f | Out-Null
reg add "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v PCAgent /t REG_SZ /d 'wscript.exe "C:\\PCAgent\\start-hidden.vbs"' /f | Out-Null
Copy-Item "C:\\PCAgent\\start-hidden.vbs" "$env:ALLUSERSPROFILE\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp\\PCAgent.vbs" -Force
netsh advfirewall firewall delete rule name="PCAgent" 2>$null | Out-Null
netsh advfirewall firewall add rule name="PCAgent" dir=out action=allow program="C:\\Program Files\\nodejs\\node.exe" | Out-Null
Start-Process wscript.exe -ArgumentList '"C:\\PCAgent\\start-hidden.vbs"'
Write-Host "       OK" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  JHS Agent Installed!" -ForegroundColor Cyan
Write-Host "  PC: $pcName ($ipv4)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
`;
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(ps);
});

// ════════════════════════════════════════════
// Self-diagnostic smoke test
// ════════════════════════════════════════════
// Runs every 5 minutes. Checks each subsystem and emits alert on failure.
// Prevents silent corruption: DB locked, agent-latest.js missing, stale agents.
const _smokeHealth = {
    lastRun: null,
    subsystems: {},
    alertsSent: new Set(),  // keys already alerted (reset on recovery)
};

async function runSmokeTest() {
    const result = { timestamp: new Date().toISOString(), checks: {} };

    // 1. DB responsive (write + read)
    result.checks.db = await new Promise((resolve) => {
        const start = Date.now();
        db.get('SELECT COUNT(*) as n FROM pc_status', (err, row) => {
            if (err) resolve({ ok: false, error: err.message });
            else resolve({ ok: true, latencyMs: Date.now() - start, pcCount: row && row.n });
        });
    });

    // 2. agent-latest.js exists and is non-trivial
    const agentLatestPath = path.join(__dirname, '..', 'frontend', 'agent-latest.js');
    try {
        const stat = fs.statSync(agentLatestPath);
        result.checks.agentSync = stat.size > 10000
            ? { ok: true, sizeKB: Math.round(stat.size / 1024) }
            : { ok: false, error: 'agent-latest.js too small: ' + stat.size };
    } catch (e) {
        result.checks.agentSync = { ok: false, error: 'agent-latest.js missing' };
    }

    // 3. License valid and not expired
    if (licenseInfo && licenseInfo.expiry) {
        const daysLeft = Math.ceil((new Date(licenseInfo.expiry) - Date.now()) / 86400000);
        result.checks.license = {
            ok: daysLeft > 0,
            daysLeft,
            academy: licenseInfo.academy,
        };
    } else {
        result.checks.license = { ok: false, error: 'no license' };
    }

    // 4. Wallpaper file accessible (for wallpaper-apply)
    const wpPath = path.join(__dirname, '..', 'frontend', 'wallpaper.png');
    try {
        const wpStat = fs.statSync(wpPath);
        result.checks.wallpaper = { ok: wpStat.size > 0, sizeKB: Math.round(wpStat.size / 1024) };
    } catch (e) {
        result.checks.wallpaper = { ok: false, error: 'wallpaper.png missing' };
    }

    // 5. Connected agents: how many? any stale (last update > 2 min ago)?
    result.checks.agents = {
        ok: true,
        connected: pcSockets.size,
        license_limit: licenseInfo && licenseInfo.maxPCs,
    };
    if (licenseInfo && licenseInfo.maxPCs && pcSockets.size > licenseInfo.maxPCs) {
        result.checks.agents.ok = false;
        result.checks.agents.error = 'Exceeds license limit';
    }

    // 6. Disk space on logs/screenshots directories
    try {
        const logStat = fs.statSync(path.join(__dirname, 'server.log'));
        result.checks.logs = {
            ok: logStat.size < 50 * 1024 * 1024,  // warn if > 50MB
            sizeMB: Math.round(logStat.size / 1024 / 1024 * 10) / 10,
        };
    } catch (e) { result.checks.logs = { ok: true, note: 'no log file yet' }; }

    _smokeHealth.lastRun = result.timestamp;
    _smokeHealth.subsystems = result.checks;

    // Alert on new failures
    const failedNow = Object.entries(result.checks).filter(([, v]) => !v.ok);
    failedNow.forEach(([name, data]) => {
        const key = 'smoke:' + name;
        if (!_smokeHealth.alertsSent.has(key)) {
            _smokeHealth.alertsSent.add(key);
            logger.error(`[SMOKE-FAIL] ${name}: ${JSON.stringify(data)}`);
            notifyAdmin('시스템 알림', 'server', `[자가진단 실패] ${name}: ${data.error || JSON.stringify(data).slice(0, 100)}`);
        }
    });
    // Clear alert state for recovered subsystems
    const failedKeys = new Set(failedNow.map(([n]) => 'smoke:' + n));
    for (const key of [..._smokeHealth.alertsSent]) {
        if (!failedKeys.has(key)) {
            _smokeHealth.alertsSent.delete(key);
            logger.info(`[SMOKE-RECOVER] ${key.replace('smoke:', '')}`);
        }
    }

    return result;
}

// Schedule: run 10 seconds after startup, then every 5 minutes
setTimeout(runSmokeTest, 10_000);
setInterval(runSmokeTest, 5 * 60_000);

// Track server start time for uptime calculation
const _serverStartTime = Date.now();

// Violation counter for auto-escalation (pcName → [timestamps])
// Bounded by PC count; each entry at most 3 timestamps before reset
const _violationCounter = new Map();

// GET /api/health/detailed — current subsystem status
app.get('/api/health/detailed', authenticateToken, (req, res) => {
    ApiResponse.ok(res, {
        lastRun: _smokeHealth.lastRun,
        subsystems: _smokeHealth.subsystems,
        uptime_sec: Math.floor((Date.now() - _serverStartTime) / 1000),
    });
});

// ════════════════════════════════════════════
// Telegram notifications — instant alerts to admin's phone
// ════════════════════════════════════════════
// Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars.
// To get them:
//   1. Talk to @BotFather on Telegram, /newbot, get token
//   2. Send any message to your bot
//   3. curl https://api.telegram.org/bot<TOKEN>/getUpdates → find chat.id
//   4. Set env vars and restart server
// Runtime-mutable so admin can set via /api/integrations without restart.
// Priority: DB (set via admin UI) > env var > empty
let TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Load saved integrations from DB on startup (overrides env if set)
setTimeout(() => {
    db.all(`SELECT key, value FROM settings WHERE key IN ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY')`, (err, rows) => {
        if (err || !rows) return;
        rows.forEach(r => {
            if (!r.value) return;
            if (r.key === 'TELEGRAM_BOT_TOKEN') TELEGRAM_BOT_TOKEN = r.value;
            else if (r.key === 'TELEGRAM_CHAT_ID') TELEGRAM_CHAT_ID = r.value;
            else if (r.key === 'ANTHROPIC_API_KEY') ANTHROPIC_API_KEY = r.value;
        });
        logger.info('Integrations loaded from DB');
    });
}, 500);

// GET /api/integrations — return which keys are configured (NOT the values!)
app.get('/api/integrations', authenticateToken, requireRole('admin'), (req, res) => {
    ApiResponse.ok(res, {
        telegram: {
            configured: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
            botTokenMasked: TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.slice(0, 6) + '...' + TELEGRAM_BOT_TOKEN.slice(-4) : '',
            chatIdMasked: TELEGRAM_CHAT_ID ? '***' + TELEGRAM_CHAT_ID.slice(-4) : '',
        },
        anthropic: {
            configured: !!ANTHROPIC_API_KEY,
            keyMasked: ANTHROPIC_API_KEY ? ANTHROPIC_API_KEY.slice(0, 8) + '...' + ANTHROPIC_API_KEY.slice(-4) : '',
        },
    });
});

// POST /api/integrations — update one or more keys (admin only)
app.post('/api/integrations', authenticateToken, requireRole('admin'), (req, res) => {
    const { telegramBotToken, telegramChatId, anthropicApiKey } = req.body || {};
    const updates = [];
    if (typeof telegramBotToken === 'string') {
        TELEGRAM_BOT_TOKEN = telegramBotToken.trim();
        updates.push(['TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN]);
    }
    if (typeof telegramChatId === 'string') {
        TELEGRAM_CHAT_ID = telegramChatId.trim();
        updates.push(['TELEGRAM_CHAT_ID', TELEGRAM_CHAT_ID]);
    }
    if (typeof anthropicApiKey === 'string') {
        ANTHROPIC_API_KEY = anthropicApiKey.trim();
        updates.push(['ANTHROPIC_API_KEY', ANTHROPIC_API_KEY]);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No keys provided' });

    // Persist to settings table
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    updates.forEach(([k, v]) => stmt.run(k, v));
    stmt.finalize();
    logger.info(`Integrations updated: ${updates.map(u => u[0]).join(', ')}`);
    ApiResponse.ok(res, { updated: updates.map(u => u[0]) });
});

// Throttle: max 1 notification per (pcName + alertType) per 5 minutes
const _telegramThrottle = new Map();
const TELEGRAM_THROTTLE_MS = 5 * 60 * 1000;

function sendTelegram(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return Promise.resolve(false);
    const https = require('https');
    const body = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
            },
        }, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.write(body);
        req.end();
    });
}

function notifyAdmin(alertType, pcName, message) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const key = pcName + ':' + alertType;
    const now = Date.now();
    const last = _telegramThrottle.get(key) || 0;
    if (now - last < TELEGRAM_THROTTLE_MS) return;
    _telegramThrottle.set(key, now);

    const academy = licenseInfo.academy || '학원';
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const text = `<b>[${academy}] ${alertType}</b>\n` +
                 `PC: <code>${pcName}</code>\n` +
                 `시각: ${time}\n` +
                 `${message}`;
    sendTelegram(text).catch(() => {});
}

// POST /api/telegram/test — send test message (admin)
app.post('/api/telegram/test', authenticateToken, requireRole('admin'), async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) {
        return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    }
    const ok = await sendTelegram(`<b>[테스트]</b>\nJHS PC Manager 텔레그램 알림 정상 작동\n시각: ${new Date().toLocaleString('ko-KR')}`);
    if (ok) ApiResponse.ok(res, { sent: true });
    else ApiResponse.serverError(res, 'Telegram send failed');
});

// ════════════════════════════════════════════
// Reports — daily/weekly activity summary
// ════════════════════════════════════════════
// GET /api/report?days=7 — JSON summary of activity
app.get('/api/report', authenticateToken, (req, res) => {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days) || 7));
    db.all(
        `SELECT pc_name, activity_type, COUNT(*) as count, MAX(timestamp) as last_seen
         FROM activity_logs
         WHERE timestamp >= datetime('now', '-' || ? || ' days')
         GROUP BY pc_name, activity_type
         ORDER BY pc_name, count DESC`,
        [days],
        (err, rows) => {
            if (err) return ApiResponse.serverError(res, err.message);
            // Group by pc_name
            const byPc = {};
            (rows || []).forEach(r => {
                if (!byPc[r.pc_name]) byPc[r.pc_name] = { total: 0, types: {} };
                byPc[r.pc_name].types[r.activity_type] = r.count;
                byPc[r.pc_name].total += r.count;
            });
            // Get violation count per PC (special metric)
            db.all(
                `SELECT pc_name, COUNT(*) as violations
                 FROM activity_logs
                 WHERE activity_type = 'block-violation'
                   AND timestamp >= datetime('now', '-' || ? || ' days')
                 GROUP BY pc_name`,
                [days],
                (err2, vrows) => {
                    (vrows || []).forEach(v => {
                        if (byPc[v.pc_name]) byPc[v.pc_name].violations = v.violations;
                    });
                    ApiResponse.ok(res, { days, generated_at: new Date().toISOString(), pcs: byPc });
                }
            );
        }
    );
});

// GET /api/report.html?days=7 — printable HTML report (for parents/audit)
app.get('/api/report.html', authenticateToken, (req, res) => {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days) || 7));
    const escape = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    db.all(
        `SELECT pc_name, activity_type, COUNT(*) as count
         FROM activity_logs
         WHERE timestamp >= datetime('now', '-' || ? || ' days')
         GROUP BY pc_name, activity_type
         ORDER BY pc_name, count DESC`,
        [days],
        (err, rows) => {
            if (err) return res.status(500).send('DB error');
            const byPc = {};
            (rows || []).forEach(r => {
                if (!byPc[r.pc_name]) byPc[r.pc_name] = {};
                byPc[r.pc_name][r.activity_type] = r.count;
            });
            const academy = licenseInfo.academy || '학원';
            const today = new Date().toISOString().split('T')[0];

            let body = '';
            Object.keys(byPc).sort().forEach(pc => {
                const types = byPc[pc];
                const total = Object.values(types).reduce((a, b) => a + b, 0);
                const violations = types['block-violation'] || 0;
                const visionFlags = types['vision-flag'] || 0;
                const messages = types['message-delivery'] || 0;
                body += `
                    <tr>
                        <td>${escape(pc)}</td>
                        <td class="num">${total}</td>
                        <td class="num ${violations > 0 ? 'bad' : ''}">${violations}</td>
                        <td class="num ${visionFlags > 0 ? 'bad' : ''}">${visionFlags}</td>
                        <td class="num">${messages}</td>
                    </tr>`;
            });

            const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>활동 보고서 — ${escape(academy)}</title>
<style>
    body { font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; color: #18181b; }
    h1 { border-bottom: 3px solid #18181b; padding-bottom: 12px; }
    .meta { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f4f4f5; padding: 12px; text-align: left; font-weight: 700; border-bottom: 2px solid #18181b; }
    td { padding: 10px 12px; border-bottom: 1px solid #e4e4e7; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bad { color: #dc2626; font-weight: 700; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e4e4e7; color: #9ca3af; font-size: 12px; }
    @media print { body { margin: 0; padding: 12px; } }
</style>
</head>
<body>
    <h1>${escape(academy)} 활동 보고서</h1>
    <p class="meta">기간: 최근 ${days}일 · 생성일: ${today}</p>
    <table>
        <thead>
            <tr>
                <th>PC</th>
                <th class="num">총 활동</th>
                <th class="num">차단 위반</th>
                <th class="num">AI 비학습 감지</th>
                <th class="num">메시지 수신</th>
            </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:40px">활동 데이터 없음</td></tr>'}</tbody>
    </table>
    <p class="footer">JHS PC Manager v` + PKG_VERSION + ` · 학습 활동 모니터링 보고서 · 교육 목적으로만 사용</p>
</body>
</html>`;
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        }
    );
});

// ════════════════════════════════════════════
// AI Vision — Claude API screen analysis
// ════════════════════════════════════════════
// Requires: ANTHROPIC_API_KEY env var. Disabled silently if missing.
let ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const _visionPending = new Map();  // requestId → { resolve, timer }
let _visionRequestCounter = 0;

function nextVisionRequestId() {
    _visionRequestCounter = (_visionRequestCounter + 1) % 1_000_000;
    return 'v' + Date.now() + '_' + _visionRequestCounter;
}

// Capture a single screenshot from a specific PC, returns Promise<base64>
function requestScreenshot(pcName, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const sid = pcSockets.get(pcName);
        if (!sid) return reject(new Error('PC not connected'));
        const sock = io.sockets.sockets.get(sid);
        if (!sock) return reject(new Error('Socket gone'));

        const requestId = nextVisionRequestId();
        const timer = setTimeout(() => {
            _visionPending.delete(requestId);
            reject(new Error('Screenshot timeout'));
        }, timeoutMs);

        _visionPending.set(requestId, { resolve, timer });

        sock.emit(`command-${pcName}`, {
            command: 'screenshot',
            params: { requestId, reason: 'vision-check' },
        });
    });
}

// Resolve pending vision requests when screenshot arrives
// (We hook into the existing 'screenshot' socket handler — see below)

// Call Claude API with the screenshot
async function analyzeWithClaude(base64Jpg, prompt) {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    const body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
            role: 'user',
            content: [
                {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpg },
                },
                { type: 'text', text: prompt },
            ],
        }],
    });

    const https = require('https');
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.anthropic.com',
            port: 443,
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-length': Buffer.byteLength(body),
            },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.error) return reject(new Error(j.error.message || JSON.stringify(j.error)));
                    const text = j.content && j.content[0] && j.content[0].text || '';
                    resolve(text.trim());
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// POST /api/vision/check/:pcName — capture + classify
app.post('/api/vision/check/:pcName', authenticateToken, requireRole('admin'), async (req, res) => {
    if (!ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
    }
    const pcName = req.params.pcName;
    try {
        const base64 = await requestScreenshot(pcName);
        const prompt = `이 화면이 학습 활동인지 비학습 활동인지 분류해줘.
- 학습: 코딩 IDE, 교재, 수업 자료, 학습 사이트 (Khan Academy, Codecademy, 백준, 코딩쏙 등), 검색
- 비학습: 게임, 유튜브 일반 영상, SNS, 만화, 스트리밍

JSON으로만 답변:
{"category": "학습"|"비학습"|"불명확", "confidence": 0-100, "detail": "한 줄 설명"}`;

        const result = await analyzeWithClaude(base64, prompt);
        // Try to parse JSON from response
        let parsed = { raw: result };
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try { parsed = JSON.parse(jsonMatch[0]); } catch (e) { /* keep raw */ }
        }
        // Log to activity feed if 비학습
        if (parsed.category === '비학습') {
            io.emit('new-activity', {
                pc_name: pcName,
                user: 'system',
                activity_type: 'vision-flag',
                details: `[AI] 비학습 감지 (신뢰도 ${parsed.confidence || '?'}%): ${parsed.detail || ''}`,
                timestamp: new Date().toISOString(),
            });
            logger.warn(`[VISION] ${pcName} flagged as 비학습: ${parsed.detail}`);
            notifyAdmin('AI 비학습 감지', pcName, `신뢰도 ${parsed.confidence || '?'}%: ${parsed.detail || ''}`);
        }
        ApiResponse.ok(res, parsed);
    } catch (err) {
        logger.error('Vision check error: ' + err.message);
        ApiResponse.serverError(res, err.message);
    }
});

// ════════════════════════════════════════════
// Schedule Rules — time-based auto block
// ════════════════════════════════════════════
// GET /api/schedule-rules — list all
app.get('/api/schedule-rules', authenticateToken, (req, res) => {
    db.all('SELECT * FROM schedule_rules ORDER BY start_time', (err, rows) => {
        if (err) return ApiResponse.serverError(res, err.message);
        res.json(rows || []);
    });
});

// POST /api/schedule-rules/import — bulk import JSON array of rules
// Body: { rules: [{ name, startTime, endTime, weekdays, action, target }, ...] }
app.post('/api/schedule-rules/import', authenticateToken, requireRole('admin'), (req, res) => {
    const rules = req.body && req.body.rules;
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules array required' });
    if (rules.length > 200) return res.status(400).json({ error: 'Max 200 rules per import' });

    const replace = !!(req.body && req.body.replace);
    const stmt = db.prepare(`INSERT INTO schedule_rules (name, start_time, end_time, weekdays, action, target, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)`);

    const doImport = () => {
        let imported = 0, errors = [];
        rules.forEach((r, idx) => {
            // Validation
            if (!r.name || !r.startTime || !r.endTime || !r.action || !r.target) {
                errors.push(`Row ${idx}: missing fields`); return;
            }
            if (!/^\d{2}:\d{2}$/.test(r.startTime) || !/^\d{2}:\d{2}$/.test(r.endTime)) {
                errors.push(`Row ${idx}: invalid time format`); return;
            }
            if (!['block-program', 'unblock-program'].includes(r.action)) {
                errors.push(`Row ${idx}: invalid action`); return;
            }
            const wd = parseInt(r.weekdays) || 62;  // default Mon-Fri
            try {
                stmt.run(r.name, r.startTime, r.endTime, wd, r.action, r.target);
                imported++;
            } catch (e) {
                errors.push(`Row ${idx}: ${e.message}`);
            }
        });
        stmt.finalize();
        ApiResponse.ok(res, { imported, errors, total: rules.length });
    };

    if (replace) {
        db.run('DELETE FROM schedule_rules', (err) => {
            if (err) return ApiResponse.serverError(res, err.message);
            doImport();
        });
    } else {
        doImport();
    }
});

// POST /api/schedule-rules — create
app.post('/api/schedule-rules', authenticateToken, requireRole('admin'), (req, res) => {
    const { name, startTime, endTime, weekdays, action, target } = req.body;
    if (!name || !startTime || !endTime || !action || !target) {
        return res.status(400).json({ error: 'name, startTime, endTime, action, target required' });
    }
    // Validation
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return res.status(400).json({ error: 'Time must be HH:MM' });
    }
    if (!['block-program', 'unblock-program'].includes(action)) {
        return res.status(400).json({ error: 'action must be block-program or unblock-program' });
    }
    const wd = parseInt(weekdays) || 127; // default: every day
    db.run(`INSERT INTO schedule_rules (name, start_time, end_time, weekdays, action, target) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, startTime, endTime, wd, action, target], function (err) {
            if (err) return ApiResponse.serverError(res, err.message);
            ApiResponse.ok(res, { id: this.lastID });
        });
});

// DELETE /api/schedule-rules/:id
app.delete('/api/schedule-rules/:id', authenticateToken, requireRole('admin'), (req, res) => {
    db.run('DELETE FROM schedule_rules WHERE id = ?', [req.params.id], (err) => {
        if (err) return ApiResponse.serverError(res, err.message);
        ApiResponse.ok(res, { deleted: true });
    });
});

// PATCH /api/schedule-rules/:id/toggle
app.patch('/api/schedule-rules/:id/toggle', authenticateToken, requireRole('admin'), (req, res) => {
    db.run('UPDATE schedule_rules SET enabled = 1 - enabled WHERE id = ?', [req.params.id], (err) => {
        if (err) return ApiResponse.serverError(res, err.message);
        ApiResponse.ok(res, { toggled: true });
    });
});

// Schedule enforcement loop — check every minute, fire matching rules
// Tracks "last fired" timestamp per rule to avoid duplicate fires within the same minute window
const _scheduleLastFire = new Map();
function enforceSchedules() {
    db.all('SELECT * FROM schedule_rules WHERE enabled = 1', (err, rules) => {
        if (err || !rules) return;
        const now = new Date();
        const dayBit = 1 << now.getDay();  // Sun=1, Mon=2, ..., Sat=64
        const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

        rules.forEach(rule => {
            if ((rule.weekdays & dayBit) === 0) return;
            // Determine if "now" is the start edge or end edge (within this minute)
            const isStart = rule.start_time === hhmm;
            const isEnd = rule.end_time === hhmm;
            if (!isStart && !isEnd) return;

            // Dedupe: same rule fired within last 30s for same edge
            const fireKey = rule.id + ':' + (isStart ? 'start' : 'end');
            const lastFire = _scheduleLastFire.get(fireKey) || 0;
            if (Date.now() - lastFire < 30_000) return;
            _scheduleLastFire.set(fireKey, Date.now());

            // Determine action: at start, apply rule.action; at end, reverse it
            const apply = isStart ? rule.action : (rule.action === 'block-program' ? 'unblock-program' : 'block-program');
            const blocked = apply === 'block-program';
            logger.info(`[SCHEDULE] Rule "${rule.name}" ${isStart ? 'started' : 'ended'}: ${apply} ${rule.target}`);

            // Apply via global '*' entry
            if (blocked) {
                db.run("INSERT OR IGNORE INTO blocked_programs (pc_name, program_name) VALUES ('*', ?)", [rule.target]);
            } else {
                db.run("DELETE FROM blocked_programs WHERE program_name = ? AND pc_name = '*'", [rule.target]);
            }
            // Sync to all agents
            pcSockets.forEach((sid, pcName) => {
                const s = io.sockets.sockets.get(sid);
                if (!s) return;
                db.all("SELECT DISTINCT program_name FROM blocked_programs WHERE pc_name = ? OR pc_name = '*'", [pcName], (e, rows) => {
                    const programs = (rows || []).map(r => r.program_name).filter(Boolean);
                    s.emit(`sync-blocked-programs-${pcName}`, { programs });
                });
            });
            // Emit to dashboard activity feed
            io.emit('new-activity', {
                pc_name: '*',
                user: 'system',
                activity_type: 'schedule',
                details: `${rule.name}: ${apply === 'block-program' ? '차단' : '해제'} (${rule.target})`,
                timestamp: new Date().toISOString(),
            });
        });
    });
}
// Run every 60 seconds
setInterval(enforceSchedules, 60_000);
// Also run shortly after startup so we don't miss the current minute
setTimeout(enforceSchedules, 5_000);

// Catch-up on startup: for any rule whose [start, end] window contains NOW,
// re-apply the action. This handles "server was down during the edge" case.
// Runs 3 seconds after startup (before regular enforce).
setTimeout(() => {
    db.all('SELECT * FROM schedule_rules WHERE enabled = 1', (err, rules) => {
        if (err || !rules) return;
        const now = new Date();
        const dayBit = 1 << now.getDay();
        const nowMin = now.getHours() * 60 + now.getMinutes();

        const toApply = [];  // dedupe: same target only applied once
        const seen = new Set();
        rules.forEach(rule => {
            if ((rule.weekdays & dayBit) === 0) return;
            const [sh, sm] = rule.start_time.split(':').map(Number);
            const [eh, em] = rule.end_time.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;
            // Handle overnight windows (start > end)
            const inWindow = startMin <= endMin
                ? (nowMin >= startMin && nowMin < endMin)
                : (nowMin >= startMin || nowMin < endMin);
            if (!inWindow) return;
            const key = rule.action + ':' + rule.target;
            if (seen.has(key)) return;
            seen.add(key);
            toApply.push(rule);
        });

        toApply.forEach(rule => {
            logger.info(`[SCHEDULE-CATCHUP] Rule "${rule.name}" currently in window: ${rule.action} ${rule.target}`);
            if (rule.action === 'block-program') {
                db.run("INSERT OR IGNORE INTO blocked_programs (pc_name, program_name) VALUES ('*', ?)", [rule.target]);
            }
            // Unblock catch-up is not needed: if rule is "unblock X" in window,
            // X should already be absent from the global set. No-op.
        });

        if (toApply.length > 0) {
            // Push full sync to all connected agents
            pcSockets.forEach((sid, pcName) => {
                const s = io.sockets.sockets.get(sid);
                if (!s) return;
                db.all("SELECT DISTINCT program_name FROM blocked_programs WHERE pc_name = ? OR pc_name = '*'", [pcName], (e, rows) => {
                    const programs = (rows || []).map(r => r.program_name).filter(Boolean);
                    s.emit(`sync-blocked-programs-${pcName}`, { programs });
                });
            });
        }
    });
}, 3_000);

// POST /api/block-program-all — apply to every online agent ('*' = global)
app.post('/api/block-program-all', authenticateToken, requireRole('admin'), (req, res) => {
    const { programName, blocked } = req.body;
    if (!programName) return res.status(400).json({ error: 'programName required' });
    const prog = programName.toLowerCase().trim();
    if (blocked !== false) {
        db.run("INSERT OR IGNORE INTO blocked_programs (pc_name, program_name) VALUES ('*', ?)",
            [prog], (err) => {
                if (err) return ApiResponse.serverError(res, err.message);
                syncBlockedProgramsToAll();
                ApiResponse.ok(res, { message: `${prog} blocked on ALL` });
            });
    } else {
        db.run("DELETE FROM blocked_programs WHERE program_name = ? AND pc_name = '*'", [prog], (err) => {
            if (err) return ApiResponse.serverError(res, err.message);
            syncBlockedProgramsToAll();
            ApiResponse.ok(res, { message: `${prog} unblocked on ALL` });
        });
    }
});

// GET /api/pcs/:name/blocked-programs
app.get('/api/pcs/:name/blocked-programs', authenticateToken, (req, res) => {
    const name = req.params.name;
    db.all('SELECT program_name FROM blocked_programs WHERE pc_name = ? ORDER BY program_name',
        [name], (err, rows) => {
            if (err) return ApiResponse.serverError(res, err.message);
            res.json({ success: true, blockedPrograms: rows.map(r => r.program_name) });
        });
});

// POST /api/pcs/send-file — command-based file push via agent (legacy stub)
app.post('/api/pcs/send-file', authenticateToken, requireRole('admin'), (req, res) => {
    const { targetIPs, sourcePath, destPath } = req.body;
    if (!targetIPs || !sourcePath || !destPath)
        return res.status(400).json({ error: 'targetIPs, sourcePath, destPath required' });
    const results = targetIPs.map(function(ip) {
        io.emit('command-' + ip, { command: 'run', params: { cmd: 'echo file-push-not-yet-impl' } });
        return { IP: ip, Success: true, message: 'Command queued' };
    });
    res.json({ success: true, results: results });
});

// ========================================
// File Transfer via Drag & Drop
// ========================================
const fileUpload = require('multer')({ dest: path.join(__dirname, 'temp-uploads'), limits: { fileSize: 100 * 1024 * 1024 } });

// POST /api/pcs/:name/send-file — drag-and-drop file transfer to agent
app.post('/api/pcs/:name/send-file', authenticateToken, requireRole('admin'), fileUpload.single('file'), async (req, res) => {
    const name = req.params.name;
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const socketId = pcSockets.get(name);
    if (!socketId) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ success: false, error: `PC "${name}" is not connected` });
    }
    const agentSocket = io.sockets.sockets.get(socketId);
    if (!agentSocket) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ success: false, error: `Socket for "${name}" not found` });
    }

    const transferId = crypto.randomUUID();
    const filename = req.file.originalname || req.file.filename;
    const CHUNK_SIZE = 64 * 1024; // 64KB

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const totalSize = fileBuffer.length;
        const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

        // Notify agent: transfer starting
        agentSocket.emit(`file-receive-start-${name}`, { transferId, filename, totalSize, totalChunks });

        // Send chunks
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, totalSize);
            const chunk = fileBuffer.slice(start, end);
            agentSocket.emit(`file-receive-chunk-${name}`, { transferId, chunkIndex: i, data: chunk });
        }

        // Signal end of transfer
        agentSocket.emit(`file-receive-end-${name}`, { transferId });

        fs.unlink(req.file.path, () => {});
        logger.info(`File transfer started: ${filename} → ${name} (${totalSize} bytes, ${totalChunks} chunks) [${transferId}]`);

        res.json({ success: true, transferId, filename, totalSize, totalChunks });
    } catch (err) {
        fs.unlink(req.file.path, () => {});
        logger.error('File transfer error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
// WebSocket (Phase 10: secured)
// ========================================
io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    metrics.inc('ws_connections');
    // Disable Nagle for low-latency input relay
    try { socket.conn?.transport?.socket?.setNoDelay?.(true); } catch (e) {}
    socket.conn?.on('upgrade', (transport) => {
        try { transport.socket?.setNoDelay?.(true); } catch (e) {}
    });
    logger.info(`WS connected: ${socket.id} (${clientIp})${socket.user ? ` [${socket.user.username}] AUTH` : ' NO-AUTH'}`);

    // Per-socket rate limiting
    let messageCount = 0;
    const rateLimitInterval = setInterval(() => { messageCount = 0; }, 1000);

    const checkRate = () => {
        messageCount++;
        if (messageCount > config.WS_RATE_LIMIT_PER_SECOND) {
            logger.warn(`WS rate limit: ${socket.id} (${messageCount}/s)`);
            return false;
        }
        return true;
    };

    socket.on('register-pc', (data) => {
        if (!checkRate()) return;
        const { pcName, ipAddress, macAddress, agentVersion } = data;
        if (!pcName || typeof pcName !== 'string') return;

        // Prevent self-registration: admin PC (running this server) should NEVER
        // register as a student. Root cause of blocks applying to teacher PC.
        //
        // Two detection strategies, either triggers rejection:
        //   1. Socket comes from localhost (127.0.0.1 / ::1)
        //   2. Reported pcName contains the server's own hostname
        //
        // Strategy 2 catches the case where agent is installed on admin PC
        // and connects via LAN IP (192.168.0.5) — socket shows 192.168.0.5
        // not loopback, so strategy 1 would miss.
        const socketIp = socket.handshake?.address || '';
        const serverHostname = _cachedHostname;
        const reportedLower = (pcName || '').toLowerCase();
        const isLoopback = socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1';
        // Exact match only — substring causes false positives when server is
        // 'codingssok' and students are 'codingssok-42' etc.
        const isSelfHost = serverHostname && reportedLower === serverHostname;
        const isSelf = isLoopback || isSelfHost;
        if (isSelf) {
            logger.warn(`Self-registration BLOCKED: ${pcName} (${ipAddress}) via ${socketIp} [loopback=${isLoopback} hostname=${isSelfHost}]`);
            socket.emit('registration-rejected', {
                reason: 'self-registration-blocked',
                message: '관리자 PC에는 에이전트를 설치하면 안 됩니다. 제거하세요.',
            });
            // Force disconnect — don't let it linger
            setTimeout(() => socket.disconnect(true), 500);
            return;
        }

        // License: check PC count limit for new PCs
        const existingPC = pcSockets.has(pcName);
        if (!existingPC && pcSockets.size >= licenseInfo.maxPCs) {
            logger.warn(`License limit: ${pcName} rejected (${pcSockets.size}/${licenseInfo.maxPCs})`);
            socket.emit('license-limit', { maxPCs: licenseInfo.maxPCs, message: `최대 ${licenseInfo.maxPCs}대 제한` });
            return;
        }

        // Track pcName on socket for disconnect handler
        socket.pcName = pcName;
        socket.agentVersion = agentVersion;
        pcSockets.set(pcName, socket.id);

        db.run(`INSERT INTO pc_status (pc_name, ip_address, mac_address, status, last_seen)
                VALUES (?, ?, ?, 'online', datetime('now'))
                ON CONFLICT(pc_name) DO UPDATE SET
                    ip_address = excluded.ip_address,
                    mac_address = COALESCE(excluded.mac_address, mac_address),
                    status = 'online',
                    last_seen = datetime('now')`, [pcName.substring(0, 64), ipAddress, macAddress || null], (err) => {
            if (err) logger.error('Error registering PC:', err);
            cache.invalidate('pcs');
            cache.invalidate('stats');
            io.emit('pc-updated', { pcName, status: 'online' });

            // Full reconciliation sync on connect — send COMPLETE desired state.
            // Agent will reconcile hosts/program state to match exactly.
            db.all("SELECT DISTINCT program_name FROM blocked_programs WHERE pc_name = ? OR pc_name = '*'", [pcName], (e2, rows) => {
                const programs = (rows || []).map(r => r.program_name).filter(Boolean);
                socket.emit(`sync-blocked-programs-${pcName}`, { programs });
                logger.info(`Sync: ${programs.length} blocked programs → ${pcName}`);
            });

            db.all('SELECT url FROM blocked_sites ORDER BY url', (e3, sites) => {
                const domains = (sites || []).map(s => s.url).filter(Boolean);
                socket.emit(`sync-blocked-sites-${pcName}`, { domains });
                logger.info(`Sync: ${domains.length} blocked sites → ${pcName}`);
            });
        });

        // Sync wallpaper lock state
        if (global._wallpaperLocked) {
            socket.emit(`wallpaper-lock-${pcName}`, { locked: true });
            logger.info(`Synced wallpaper lock to ${pcName}`);
        }

        // Sync exam mode state — re-apply lockdown on reconnect
        if (global._examMode) {
            socket.emit(`exam-mode-${pcName}`, {
                enabled: true,
                whitelist: [],
                message: '시험 모드 진행 중입니다.',
            });
            logger.info(`Synced exam mode to ${pcName}`);
        }

        // Auto-start stream if CCTV room is active
        const cctvRoom = io.sockets.adapter.rooms.get('cctv-room');
        if (cctvRoom && cctvRoom.size > 0) {
            // Restore remembered CCTV mode (MJPEG or H.264) if present
            const last = _streamModeByPc.get(pcName);
            const cctvPayload = last && (last.mode === 'h264' || last.mode === 'cctv')
                ? { fps: last.fps, quality: last.quality, mode: last.mode }
                : { fps: 3, quality: 30, mode: 'cctv' };
            socket.emit(`start-stream-${pcName}`, cctvPayload);
        }

        // Auto-resume live view if a dashboard is still viewing this PC (reconnect recovery).
        // Restore the last-used mode/fps/quality so H.264 streams aren't silently downgraded to MJPEG.
        const liveRoom = io.sockets.adapter.rooms.get(`stream-${pcName}`);
        if (liveRoom && liveRoom.size > 0 && (!cctvRoom || cctvRoom.size === 0)) {
            const last = _streamModeByPc.get(pcName) || { fps: 15, quality: 80 };
            socket.emit(`start-stream-${pcName}`, last);
            logger.info(`Auto-resumed live stream for ${pcName} (${liveRoom.size} viewers, mode=${last.mode || 'mjpeg'})`);
        }

        // Supabase mirroring (fire-and-forget)
        mirror.onPcConnect(pcName, ipAddress);
    });

    socket.on('update-status', (data) => {
        if (!checkRate()) return;
        const { pcName, cpuUsage, memoryUsage, ts, activeWindow } = data;
        if (!pcName) return;

        // Calculate round-trip latency if agent sent timestamp
        const latencyMs = ts ? Math.max(0, Date.now() - ts) : null;

        // DB update without cache invalidation (cache warms every 30s anyway)
        db.run(`UPDATE pc_status SET cpu_usage = ?, memory_usage = ?, status = 'online', last_seen = datetime('now')
                WHERE pc_name = ?`, [cpuUsage, memoryUsage, pcName]);
        // Send update directly to dashboard clients (skip cache)
        io.emit('pc-updated', { pcName, cpuUsage, memoryUsage, status: 'online', latencyMs, activeWindow });
    });

    socket.on('log-activity', (data) => {
        if (!checkRate()) return;
        const { pcName, user, activityType, details } = data;
        if (!pcName || !activityType) return;
        const normalizedDetails = typeof details === 'object' ? JSON.stringify(details) : details;
        const activityEntry = {
            pc_name: pcName,
            user,
            activity_type: activityType,
            details: normalizedDetails,
            timestamp: new Date().toISOString(),
        };
        db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
            [pcName, user, activityType, normalizedDetails], (err) => {
                if (!err) {
                    io.emit('new-activity', activityEntry);
                }
            });
        metrics.inc('ws_messages');

        // Supabase mirroring — map activityType to event_type
        const eventTypeMap = {
            'app_open': 'app_open', 'app_close': 'app_close',
            'web_visit': 'web_visit', 'lock': 'lock', 'unlock': 'unlock',
            'program_start': 'app_open', 'program_end': 'app_close',
            'website_visit': 'web_visit',
        };
        const eventType = eventTypeMap[activityType] || activityType;
        const parsedDetails = typeof details === 'object' ? details : {};
        mirror.queueActivity(pcName, eventType, {
            appName: parsedDetails.appName || parsedDetails.app_name || parsedDetails.name || null,
            url: parsedDetails.url || null,
        });
    });

    socket.on('screenshot', (data) => {
        if (!checkRate()) return;
        const { pcName, filename, fileData, reason, program, requestId } = data;
        if (!pcName || !filename || !fileData) return;

        // RPC: if this screenshot was requested via vision check, resolve the pending promise
        if (requestId && _visionPending.has(requestId)) {
            const pending = _visionPending.get(requestId);
            clearTimeout(pending.timer);
            _visionPending.delete(requestId);
            try { pending.resolve(fileData); } catch (e) { /* ignore */ }
            // Don't save vision-check screenshots to disk (they're transient)
            if (reason === 'vision-check') return;
        }

        const screenshotDir = path.join(__dirname, 'screenshots');
        const fs = require('fs');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

        // Sanitize filename + cap base64 size to prevent OOM (max 10MB raw)
        if (fileData.length > 14_000_000) return;
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
        const filePath = path.join(screenshotDir, safeName);
        let buffer;
        try { buffer = Buffer.from(fileData, 'base64'); }
        catch (e) { logger.warn('Bad base64 screenshot from ' + pcName); return; }

        fs.writeFile(filePath, buffer, (err) => {
            if (err) { logger.error('Error saving screenshot:', err); return; }
            const reasonStr = reason || 'manual';
            db.run(`INSERT INTO screenshots (pc_name, filename, filepath, file_size, reason, program) VALUES (?, ?, ?, ?, ?, ?)`,
                [pcName, safeName, filePath, buffer.length, reasonStr, program || null]);
            io.emit('screenshot-received', { pcName, filename: safeName, reason: reasonStr, program });

            // For violations, also push to activity feed for visibility
            if (reasonStr === 'block-violation') {
                io.emit('new-activity', {
                    pc_name: pcName,
                    user: 'system',
                    activity_type: 'block-violation',
                    details: `차단된 ${program || '프로그램'} 실행 시도 (스크린샷 저장)`,
                    timestamp: new Date().toISOString(),
                });
                logger.warn(`[FORENSIC] ${pcName} ran blocked program: ${program} (screenshot saved)`);
            }

            mirror.onScreenshot(pcName);
        });
    });

    // ── 실시간 스트리밍 (binary frames) ──
    socket.on('screen-frame', (data) => {
        const pcName = data.p || data.pcName;
        if (!pcName) return;
        // Track last frame arrival for stall detection
        const s = _streamStats.get(pcName) || { frames: 0, bytes: 0, lastFrameAt: 0 };
        s.frames++;
        s.bytes += (data.f?.byteLength || data.f?.length || 0);
        s.lastFrameAt = Date.now();
        _streamStats.set(pcName, s);
        // Relay to viewers
        io.to(`stream-${pcName}`).volatile.emit('screen-frame', data);
        io.to('cctv-room').volatile.emit('cctv-frame', data);
    });

    // ── Agent stream telemetry (every 5s) ──
    socket.on('stream-stats', (data) => {
        const pcName = data.p || data.pcName;
        if (!pcName) return;
        const s = _streamStats.get(pcName) || {};
        s.agentFps = data.fps;
        s.agentDrops = data.drops;
        s.kbps = data.kbps;
        s.agentTotalFrames = data.totalFrames;
        s.agentSinceLastFrame = data.sinceLastFrame;
        s.mode = data.mode;
        s.codec = data.codec;
        s.rssMB = data.rssMB;
        s.lastStatsAt = Date.now();
        _streamStats.set(pcName, s);
        // Forward to dashboard observers
        io.to(`stream-${pcName}`).volatile.emit('stream-stats', { pcName, ...data });
        io.to('cctv-room').volatile.emit('stream-stats', { pcName, ...data });
    });

    // Session recording handlers removed per user request.

    socket.on('start-cctv-request', (data) => {
        socket.join('cctv-room');
        const cctvFps = (data && data.fps) || 3;
        const cctvQuality = (data && data.quality) || 30;
        // H.264 saves ~5x bandwidth vs MJPEG for 9-PC grid. Let client opt-in (default MJPEG for compat).
        const useH264 = !!(data && data.h264);
        const mode = useH264 ? 'h264' : 'cctv';
        pcSockets.forEach((socketId, pcName) => {
            const pcSocket = io.sockets.sockets.get(socketId);
            if (pcSocket) {
                pcSocket.emit(`start-stream-${pcName}`, { fps: cctvFps, quality: cctvQuality, mode });
                _streamModeByPc.set(pcName, { fps: cctvFps, quality: cctvQuality, mode });
            }
        });
        logger.info(`CCTV started by ${socket.id} (fps:${cctvFps}, q:${cctvQuality}, mode:${mode})`);
    });

    socket.on('stop-cctv-request', () => {
        socket.leave('cctv-room');
        // Stop streams that only CCTV was using (not single-viewer)
        pcSockets.forEach((socketId, pcName) => {
            const streamRoom = io.sockets.adapter.rooms.get(`stream-${pcName}`);
            if (!streamRoom || streamRoom.size === 0) {
                const pcSocket = io.sockets.sockets.get(socketId);
                if (pcSocket) pcSocket.emit(`stop-stream-${pcName}`);
            }
        });
        logger.info(`CCTV stopped by ${socket.id}`);
    });

    socket.on('start-stream-request', (data) => {
        const { pcName, fps, quality, mode, monitor } = data || {};
        if (!pcName) return;
        socket.join(`stream-${pcName}`);
        // Remember this stream's mode/params so register-pc auto-resume can restore correctly
        _streamModeByPc.set(pcName, { fps, quality, mode, monitor });
        const agentSocketId = pcSockets.get(pcName);
        if (agentSocketId) {
            const agentSocket = io.sockets.sockets.get(agentSocketId);
            if (agentSocket) agentSocket.emit(`start-stream-${pcName}`, { fps, quality, mode, monitor });
        }
        logger.info(`Stream started for ${pcName} by ${socket.id} (mode=${mode || 'mjpeg'}, fps=${fps}, q=${quality})`);
    });

    socket.on('stop-stream-request', (data) => {
        // 관리자 → Agent에게 스트리밍 중단 요청
        const { pcName } = data;
        if (!pcName) return;
        socket.leave(`stream-${pcName}`);
        // 룸에 아무도 없으면 Agent도 중단
        const room = io.sockets.adapter.rooms.get(`stream-${pcName}`);
        if (!room || room.size === 0) {
            const agentSocketId = pcSockets.get(pcName);
            if (agentSocketId) {
                const agentSocket = io.sockets.sockets.get(agentSocketId);
                if (agentSocket) agentSocket.emit(`stop-stream-${pcName}`);
            }
        }
        logger.info(`Stream stopped for ${pcName} by ${socket.id}`);
    });

    // ── 원격 제어 릴레이 (admin-only — prevent student-to-student control) ──
    // Auth: socket.user (JWT) OR socket is not a registered agent (dashboard client)
    const isAdmin = () => socket.user || !socket.pcName;
    socket.on('remote-mouse', (data) => {
        if (!data || !data.pcName || !isAdmin()) return;
        const sid = pcSockets.get(data.pcName);
        if (sid) { const s = io.sockets.sockets.get(sid); if (s) s.volatile.emit(`remote-mouse-${data.pcName}`, data); }
    });
    socket.on('remote-keyboard', (data) => {
        if (!data || !data.pcName || !isAdmin()) return;
        const sid = pcSockets.get(data.pcName);
        if (sid) { const s = io.sockets.sockets.get(sid); if (s) s.emit(`remote-keyboard-${data.pcName}`, data); }
    });
    socket.on('remote-scroll', (data) => {
        if (!data || !data.pcName || !isAdmin()) return;
        const sid = pcSockets.get(data.pcName);
        if (sid) { const s = io.sockets.sockets.get(sid); if (s) s.volatile.emit(`remote-scroll-${data.pcName}`, data); }
    });

    // ── File transfer progress relay: agent → dashboard ──
    socket.on('file-transfer-progress', (data) => {
        // Agent emits progress; relay to all dashboard clients
        io.emit('file-transfer-progress', data);
    });

    socket.on('file-transfer-complete', (data) => {
        io.emit('file-transfer-complete', data);
    });

    // H.264 diagnostic: agent reports why H.264 failed/exited
    socket.on('h264-diag', (data) => {
        logger.warn(`H.264 diag from ${data.pcName}: code=${data.code} frames=${data.frames} bytes=${data.bytes}`);
        io.emit('h264-diag', data);
    });

    // Input latency RTT probe
    socket.on('input-ping', (data) => {
        if (!socket.user) return;
        const { pcName } = data || {};
        const sid = pcSockets.get(pcName);
        if (!sid) return;
        const pcSocket = io.sockets.sockets.get(sid);
        if (pcSocket) pcSocket.emit(`input-ping-${pcName}`, { clientT: data.clientT });
    });
    socket.on('input-pong', (data) => {
        // Relay back to originator room — all dashboards in stream room get it
        io.to(`stream-${data.pcName}`).emit('input-pong', data);
    });

    // Adaptive bitrate: viewer reports its receive performance; relay to target PC agent
    socket.on('viewer-quality', (data) => {
        if (!socket.user) return;
        const { pcName } = data || {};
        if (!pcName) return;
        const sid = pcSockets.get(pcName);
        if (!sid) return;
        const pcSocket = io.sockets.sockets.get(sid);
        if (pcSocket) pcSocket.emit(`viewer-quality-${pcName}`, data);
    });

    // ── Clipboard auto-sync (bidirectional) ──
    // Agent emits when its clipboard changes (only while being viewed); relay to viewers
    socket.on('clipboard-changed', (data) => {
        const pcName = data?.pcName;
        if (!pcName) return;
        io.to(`stream-${pcName}`).emit('clipboard-changed', data);
    });
    // Dashboard pushes text to student PC clipboard
    socket.on('clipboard-set', (data) => {
        if (!socket.user) return;
        const pcName = data?.pcName;
        if (!pcName) return;
        const sid = pcSockets.get(pcName);
        if (!sid) return;
        const pcSocket = io.sockets.sockets.get(sid);
        if (pcSocket) pcSocket.emit(`clipboard-set-${pcName}`, { text: data.text || '' });
    });

    // ── File download (PC → Dashboard) ──
    // Dashboard requests a file from a student PC. Agent streams chunks back via relay.
    socket.on('file-download-request', (data) => {
        if (!socket.user) return;
        const { pcName, remotePath } = data || {};
        if (!pcName || !remotePath) return;
        const sid = pcSockets.get(pcName);
        if (!sid) {
            socket.emit('file-download-error', { error: 'PC not connected' }); return;
        }
        const pcSocket = io.sockets.sockets.get(sid);
        if (!pcSocket) { socket.emit('file-download-error', { error: 'Socket gone' }); return; }
        const transferId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        pcSocket.emit(`file-download-request-${pcName}`, { transferId, remotePath, requesterSocketId: socket.id });
        logger.info(`File download started: ${pcName}:${remotePath} → ${socket.id} [${transferId}]`);
    });

    // Agent-origin relays: route back to the specific requester via requesterSocketId
    ['file-download-start', 'file-download-chunk', 'file-download-end', 'file-download-error'].forEach(evt => {
        socket.on(evt, (data) => {
            const { requesterSocketId } = data || {};
            if (!requesterSocketId) return;
            const target = io.sockets.sockets.get(requesterSocketId);
            if (target) target.emit(evt, data);
        });
    });

    // ── Teacher screen share ──
    // Student viewers join the teacher-screen room
    socket.on('join-teacher-screen', () => {
        socket.join('teacher-screen-viewers');
    });

    // Teacher sends frames → relay to all viewers (browser-based students)
    socket.on('teacher-screen-frame', (data) => {
        if (!socket.user) return;
        io.to('teacher-screen-viewers').volatile.emit('teacher-screen-data', data);
    });

    // Teacher stops → notify viewers + send open-url to agents
    socket.on('teacher-screen-stop', () => {
        if (!socket.user) return;
        io.to('teacher-screen-viewers').emit('teacher-screen-ended');
    });

    // Teacher starts sharing → open viewer on all student PCs
    socket.on('teacher-screen-start', () => {
        if (!socket.user) return;
        const viewerUrl = `http://${require('os').hostname()}:${config.PORT}/teacher-screen.html`;
        pcSockets.forEach((sid, pcName) => {
            const s = io.sockets.sockets.get(sid);
            if (s) s.emit(`command-${pcName}`, { command: 'open-url', params: { url: viewerUrl } });
        });
        logger.info('Teacher screen share: opened viewer on all PCs');
    });

    // Block violation alert: agent killed a blocked program
    // Auto-escalation: 3 violations in 10 minutes → auto-lock that specific PC
    socket.on('block-violation', (data) => {
        io.emit('block-violation', data);
        logger.warn(`Block violation: ${data.pcName} ran ${data.program}`);
        notifyAdmin('차단 위반', data.pcName, `차단된 <code>${data.program}</code> 실행 시도`);

        // Track rolling 10-minute window
        const now = Date.now();
        const windowMs = 10 * 60 * 1000;
        const history = (_violationCounter.get(data.pcName) || []).filter(t => now - t < windowMs);
        history.push(now);
        _violationCounter.set(data.pcName, history);

        // Auto-escalate at 3 violations
        if (history.length === 3) {
            logger.warn(`[AUTO-ESCALATE] ${data.pcName} hit 3 violations in 10min → locking screen`);
            const sid = pcSockets.get(data.pcName);
            if (sid) {
                const sock = io.sockets.sockets.get(sid);
                if (sock) {
                    sock.emit(`command-${data.pcName}`, { command: 'lock', params: {} });
                    sock.emit(`command-${data.pcName}`, {
                        command: 'message',
                        params: { message: '반복적 차단 위반 감지 — 선생님께 가세요.', durationMs: 15000 }
                    });
                }
            }
            notifyAdmin('반복 위반 → 자동 잠금', data.pcName, `10분 내 3회 차단 위반. PC 자동 잠금 + 메시지 전송`);
            io.emit('new-activity', {
                pc_name: data.pcName,
                user: 'system',
                activity_type: 'auto-escalate',
                details: '반복 차단 위반 → 자동 잠금',
                timestamp: new Date().toISOString(),
            });
            // Reset counter so we don't re-fire until fresh 3 within another 10min
            _violationCounter.delete(data.pcName);
        }
    });

    socket.on('disconnect', () => {
        clearInterval(rateLimitInterval);
        const count = wsConnections.get(clientIp) || 1;
        wsConnections.set(clientIp, Math.max(0, count - 1));
        if (wsConnections.get(clientIp) === 0) wsConnections.delete(clientIp);
        metrics.set('active_connections', io.engine?.clientsCount || 0);
        logger.info(`WS disconnected: ${socket.id}`);

        if (socket.pcName) {
            // Guard: only delete if this socket is still the active one (prevents race with reconnect)
            if (pcSockets.get(socket.pcName) === socket.id) {
                pcSockets.delete(socket.pcName);
            }
            // Mark offline immediately in DB
            db.run(`UPDATE pc_status SET status = 'offline' WHERE pc_name = ?`, [socket.pcName], () => {
                cache.invalidate('pcs');
                cache.invalidate('stats');
                io.emit('pc-updated', { pcName: socket.pcName, status: 'offline' });
            });
            // Emit activity log for real-time feed
            const disconnectEntry = {
                pc_name: socket.pcName,
                user: 'system',
                activity_type: 'logout',
                details: 'Agent disconnected',
                timestamp: new Date().toISOString(),
            };
            db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
                [socket.pcName, 'system', 'logout', 'Agent disconnected']);
            io.emit('new-activity', disconnectEntry);
            mirror.onPcDisconnect(socket.pcName);
        }
    });
});


// ========================================
// Background Scheduler (Phase 16)
// ========================================

// Job 1: Mark PCs offline if not seen for 5 minutes
scheduler.register('pc-health-check', () => {
    db.run(`UPDATE pc_status SET status = 'offline'
            WHERE status = 'online' AND datetime(last_seen) < datetime('now', '-5 minutes')`,
        function (err) {
            if (!err && this.changes > 0) {
                logger.info(`Scheduler: marked ${this.changes} PCs offline`);
                cache.invalidate('pcs');
                cache.invalidate('stats');
                io.emit('pcs-status-changed');
            }
        });
}, config.PC_HEALTH_CHECK_INTERVAL_MS, true);

// Job 2: Clean old logs (>30 days)
scheduler.register('log-cleanup', () => {
    db.run(`DELETE FROM activity_logs WHERE timestamp < datetime('now', '-' || ? || ' days')`, [config.LOG_RETENTION_DAYS],
        function (err) {
            if (!err && this.changes > 0) {
                logger.info(`Scheduler: cleaned ${this.changes} old log entries`);
            }
        });
}, config.LOG_CLEANUP_INTERVAL_MS);

// Job 2b: Clean old screenshots (>7 days)
scheduler.register('screenshot-cleanup', () => {
    db.all(`SELECT id, filepath FROM screenshots WHERE captured_at < datetime('now', '-7 days')`, (err, rows) => {
        if (err || !rows || rows.length === 0) return;
        rows.forEach(r => {
            try { if (r.filepath && fs.existsSync(r.filepath)) fs.unlinkSync(r.filepath); } catch (e) {}
        });
        db.run(`DELETE FROM screenshots WHERE captured_at < datetime('now', '-7 days')`, function(e2) {
            if (!e2 && this.changes > 0) logger.info(`Scheduler: cleaned ${this.changes} old screenshots`);
        });
    });
}, 6 * 3600 * 1000); // every 6 hours

// Job 2c: Purge stale throttle/counter maps (prevent slow memory leak)
scheduler.register('map-cleanup', () => {
    const now = Date.now();
    for (const [key, ts] of _telegramThrottle) {
        if (now - ts > 30 * 60 * 1000) _telegramThrottle.delete(key); // 30min stale
    }
    for (const [key, arr] of _violationCounter) {
        const fresh = arr.filter(t => now - t < 10 * 60 * 1000);
        if (fresh.length === 0) _violationCounter.delete(key);
        else _violationCounter.set(key, fresh);
    }
    // Clean schedule fire timestamps
    for (const [key, ts] of _scheduleLastFire) {
        if (now - ts > 120_000) _scheduleLastFire.delete(key);
    }
    // Clean stale WebSocket IP tracking
    for (const [ip, count] of wsConnections) {
        if (count <= 0) { wsConnections.delete(ip); continue; }
        let found = false;
        for (const [, s] of io.sockets.sockets) {
            if (s.handshake?.address === ip) { found = true; break; }
        }
        if (!found) wsConnections.delete(ip);
    }
}, 10 * 60 * 1000); // every 10 minutes

// Job 3: Cache warming
scheduler.register('cache-warm', () => {
    db.all(`SELECT * FROM pc_status ORDER BY pc_name`, (err, rows) => {
        if (!err) cache.set('pcs', rows, config.CACHE_TTL_PCS);
    });
    db.all(`SELECT * FROM blocked_sites ORDER BY url`, (err, rows) => {
        if (!err) cache.set('blocked-sites', rows, config.CACHE_TTL_BLOCKED);
    });
}, config.CACHE_WARM_INTERVAL_MS, true);

// Job 4: DB optimization (every 6 hours)
scheduler.register('db-optimize', () => {
    rawDb.run('PRAGMA optimize');
    logger.info('Scheduler: DB optimized (analyze)');
}, 6 * 3600 * 1000);

scheduler.start();


// (H.264 WebSocket relay removed — will be added back after proper testing)


// ========================================
// Error Handling (MUST be after all routes)
// ========================================
app.use(notFoundHandler);
app.use(errorHandler);


// ========================================
// Server Start
// ========================================
server.listen(config.PORT, () => {
    logger.info('');
    logger.info('╔══════════════════════════════════════════╗');
    logger.info('║  JHS PC MANAGER                          ║');
    logger.info('║  v' + PKG_VERSION + '  Full Reconciliation + AI Vision');
    logger.info('╠══════════════════════════════════════════╣');
    logger.info(`║  URL:     http://localhost:${config.PORT}`.padEnd(44) + '║');
    logger.info(`║  Mode:    ${config.NODE_ENV}`.padEnd(44) + '║');
    logger.info(`║  PID:     ${process.pid}`.padEnd(44) + '║');
    logger.info('╠══════════════════════════════════════════╣');
    logger.info('║  Modules: auth, credentials, management  ║');
    logger.info('║           remote, deploy, network, security║');
    logger.info('╠══════════════════════════════════════════╣');
    logger.info('║  Health:  GET /api/health                 ║');
    logger.info('║  Metrics: GET /api/metrics                ║');
    logger.info('║  Docs:    GET /api/docs                   ║');
    logger.info('║  Audit:   GET /api/audit                  ║');
    logger.info('╚══════════════════════════════════════════╝');
    logger.info('');
});

// Graceful shutdown
const shutdown = async (signal) => {
    logger.info(`\n${signal} received — graceful shutdown...`);
    scheduler.stop();
    metrics.destroy();

    // Flush remaining Supabase activity logs
    try { await mirror.flush(); } catch (e) { /* best-effort */ }

    server.close(() => {
        rawDb.run('PRAGMA optimize', () => {
            rawDb.close(() => {
                logger.info('Server shutdown complete.');
                process.exit(0);
            });
        });
    });

    // Force kill after 10s
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    audit.log('uncaught_exception', { details: err.message, severity: 'critical' });
});
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', reason);
    audit.log('unhandled_rejection', { details: String(reason), severity: 'critical' });
});
