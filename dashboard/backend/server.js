// server.js
// Central PC Management Dashboard - Backend API
// v20.0 — Ultimate Performance + Production Hardened
// Phases 1-20: Security, Modular, Logging, Validation, WebSocket Auth,
//              DB Wrapper, LRU Cache, Response Standard, Cluster, Audit,
//              Scheduler, Upload, API Docs, Metrics, Production Polish

// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');
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
const { generateToken, authenticateToken, optionalAuth, requireRole } = require('./auth.middleware');

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
    maxHttpBufferSize: 1e7, // 10MB for screenshots
    pingTimeout: 30000,
    pingInterval: 10000,
});

// WebSocket connection tracking (Phase 10)
const wsConnections = new Map(); // ip -> count

io.use((socket, next) => {
    // Rate limit per IP
    const ip = socket.handshake.address;
    const count = wsConnections.get(ip) || 0;
    if (count >= config.WS_MAX_CONNECTIONS_PER_IP) {
        logger.warn(`WebSocket rate limit: ${ip} (${count} connections)`);
        return next(new Error('Too many connections'));
    }
    wsConnections.set(ip, count + 1);

    // Optional JWT auth for WS
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
        try {
            const jwt = require('jsonwebtoken');
            socket.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
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
    res.setHeader('X-Powered-By', 'Enterprise-PC-Manager/v20.0');
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
    maxAge: 0,
    etag: false,
    lastModified: true,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
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
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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
        captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Migration: add file_size if not exists
    rawDb.all(`PRAGMA table_info(screenshots)`, (err, cols) => {
        if (cols && !cols.find(c => c.name === 'file_size'))
            rawDb.run(`ALTER TABLE screenshots ADD COLUMN file_size INTEGER DEFAULT 0`);
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
    rawDb.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES ('twitch.tv')`);

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
const managementRoutes = require('./routes/management')({ db, io, authenticateToken });

const { encryptPassword, decryptPassword } = credentialRoutes;

const remoteRoutes = require('./routes/remote')({ db, io, exec, authenticateToken, requireRole, decryptPassword });
const deployRoutes = require('./routes/deploy')({ db, io, exec, authenticateToken, requireRole, encryptPassword, decryptPassword, PORT: config.PORT });
const networkRoutes = require('./routes/network')({ db, io, exec, authenticateToken, requireRole, PORT: config.PORT });
const securityRoutes = require('./routes/security')({ db, io, exec, authenticateToken, requireRole });

// Mount all route modules
app.use('/api/auth', authRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api', managementRoutes);
app.use('/api/remote', remoteRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/network', networkRoutes);
app.use('/api', securityRoutes);

// ========================================
// Health Check (Phase 6, enhanced Phase 20)
// ========================================
const startTime = Date.now();

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
        version: '20.0',
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
        version: '20.0',
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
                list: { method: 'GET', path: '/api/pcs', auth: false },
                delete: { method: 'DELETE', path: '/api/pcs/:name', auth: true },
                command: { method: 'POST', path: '/api/pcs/:name/command', auth: false },
                status: { method: 'POST', path: '/api/pcs/:name/status', auth: false },
            },
            logs: { method: 'GET', path: '/api/logs', auth: false },
            stats: { method: 'GET', path: '/api/stats', auth: false },
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

app.get('/api/pcs', cache.etagMiddleware('pcs'), (req, res) => {
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
        db.run(`DELETE FROM activity_logs WHERE pc_name = ?`, [pcName]);
        cache.invalidate('pcs');
        cache.invalidate('stats');
        io.emit('pc-deleted', { pcName });
        ApiResponse.ok(res, { message: `PC ${pcName} deleted`, deleted: this.changes });
    });
});

app.post('/api/pcs/:name/command', (req, res) => {
    const { name } = req.params;
    const { command, params } = req.body;
    io.emit(`command-${name}`, { command, params });
    ApiResponse.ok(res, { message: `Command sent to ${name}` });
});

app.post('/api/pcs/:name/status', (req, res) => {
    const { name } = req.params;
    const { pcName, ipAddress, cpuUsage, memoryUsage } = req.body;
    const actualPcName = pcName || name;
    db.run(`INSERT OR REPLACE INTO pc_status (pc_name, ip_address, cpu_usage, memory_usage, status, last_seen)
            VALUES (?, ?, ?, ?, 'online', datetime('now'))`,
        [actualPcName, ipAddress, cpuUsage, memoryUsage], (err) => {
            if (err) return ApiResponse.serverError(res, err.message);
            cache.invalidate('pcs');
            cache.invalidate('stats');
            io.emit('pc-updated', { pcName: actualPcName, ipAddress, cpuUsage, memoryUsage });
            ApiResponse.ok(res);
        });
});

app.get('/api/logs', (req, res) => {
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

app.get('/api/stats', cache.etagMiddleware('stats'), (req, res) => {
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
// WebSocket (Phase 10: secured)
// ========================================
io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    metrics.inc('ws_connections');
    logger.info(`WS connected: ${socket.id} (${clientIp})${socket.user ? ` [${socket.user.username}]` : ''}`);

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
        const { pcName, ipAddress } = data;
        if (!pcName || typeof pcName !== 'string') return;

        // Track pcName on socket for disconnect handler
        socket.pcName = pcName;

        db.run(`INSERT OR REPLACE INTO pc_status (pc_name, ip_address, status, last_seen)
                VALUES (?, ?, 'online', datetime('now'))`, [pcName.substring(0, 64), ipAddress], (err) => {
            if (err) logger.error('Error registering PC:', err);
            cache.invalidate('pcs');
            cache.invalidate('stats');
            io.emit('pc-updated', { pcName, status: 'online' });
        });

        // Supabase mirroring (fire-and-forget)
        mirror.onPcConnect(pcName, ipAddress);
    });

    socket.on('update-status', (data) => {
        if (!checkRate()) return;
        const { pcName, cpuUsage, memoryUsage } = data;
        if (!pcName) return;

        db.run(`UPDATE pc_status SET cpu_usage = ?, memory_usage = ?, status = 'online', last_seen = datetime('now')
                WHERE pc_name = ?`, [cpuUsage, memoryUsage, pcName]);
        cache.invalidate('pcs');
        io.emit('pc-updated', data);
    });

    socket.on('log-activity', (data) => {
        if (!checkRate()) return;
        const { pcName, user, activityType, details } = data;
        if (!pcName || !activityType) return;
        db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
            [pcName, user, activityType, typeof details === 'object' ? JSON.stringify(details) : details]);
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
        const { pcName, filename, fileData } = data;
        if (!pcName || !filename || !fileData) return;

        const screenshotDir = path.join(__dirname, 'screenshots');
        const fs = require('fs');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

        // Sanitize filename
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
        const filePath = path.join(screenshotDir, safeName);
        const buffer = Buffer.from(fileData, 'base64');

        fs.writeFile(filePath, buffer, (err) => {
            if (err) { logger.error('Error saving screenshot:', err); return; }
            db.run(`INSERT INTO screenshots (pc_name, filename, filepath, file_size) VALUES (?, ?, ?, ?)`,
                [pcName, safeName, filePath, buffer.length]);
            io.emit('screenshot-received', { pcName, filename: safeName });

            // Supabase mirroring
            mirror.onScreenshot(pcName);
        });
    });

    // ── 실시간 스트리밍 ──
    socket.on('screen-frame', (data) => {
        // Agent → 해당 PC를 시청 중인 관리자에게만 릴레이
        const { pcName } = data;
        if (!pcName) return;
        io.to(`stream-${pcName}`).emit('screen-frame', data);
    });

    socket.on('start-stream-request', (data) => {
        // 관리자 → Agent에게 스트리밍 시작 요청
        const { pcName, fps, quality } = data;
        if (!pcName) return;
        socket.join(`stream-${pcName}`);
        io.emit(`start-stream-${pcName}`, { fps, quality });
        logger.info(`Stream started for ${pcName} by ${socket.id}`);
    });

    socket.on('stop-stream-request', (data) => {
        // 관리자 → Agent에게 스트리밍 중단 요청
        const { pcName } = data;
        if (!pcName) return;
        socket.leave(`stream-${pcName}`);
        // 룸에 아무도 없으면 Agent도 중단
        const room = io.sockets.adapter.rooms.get(`stream-${pcName}`);
        if (!room || room.size === 0) {
            io.emit(`stop-stream-${pcName}`);
        }
        logger.info(`Stream stopped for ${pcName} by ${socket.id}`);
    });

    socket.on('disconnect', () => {
        clearInterval(rateLimitInterval);
        const count = wsConnections.get(clientIp) || 1;
        wsConnections.set(clientIp, Math.max(0, count - 1));
        if (wsConnections.get(clientIp) === 0) wsConnections.delete(clientIp);
        metrics.set('active_connections', io.engine?.clientsCount || 0);
        logger.info(`WS disconnected: ${socket.id}`);

        // Supabase mirroring — mark PC offline
        if (socket.pcName) {
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
    db.run(`DELETE FROM activity_logs WHERE timestamp < datetime('now', '-${config.LOG_RETENTION_DAYS} days')`,
        function (err) {
            if (!err && this.changes > 0) {
                logger.info(`Scheduler: cleaned ${this.changes} old log entries`);
            }
        });
}, config.LOG_CLEANUP_INTERVAL_MS);

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
    logger.info('║  ENTERPRISE PC MANAGEMENT DASHBOARD      ║');
    logger.info('║  v20.0 — Ultimate Performance Engine     ║');
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
