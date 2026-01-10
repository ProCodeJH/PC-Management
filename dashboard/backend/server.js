// server.js
// Central PC Management Dashboard - Backend API

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('enterprise-pc.db');

db.serialize(() => {
    // PC 상태 테이블
    db.run(`CREATE TABLE IF NOT EXISTS pc_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        status TEXT,
        cpu_usage REAL,
        memory_usage REAL,
        group_id INTEGER,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 활동 로그 테이블
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        user TEXT,
        activity_type TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 설정 테이블
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    // 사용자 인증 테이블
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'viewer',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 기본 관리자 계정 생성
    db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')`);

    // PC 그룹 테이블
    db.run(`CREATE TABLE IF NOT EXISTS pc_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        policy TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 스크린샷 테이블
    db.run(`CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        filename TEXT,
        filepath TEXT,
        captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 출석 테이블
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pc_name TEXT NOT NULL,
        date TEXT NOT NULL,
        first_login DATETIME,
        last_logout DATETIME,
        UNIQUE(pc_name, date)
    )`);

    // 차단 사이트 테이블
    db.run(`CREATE TABLE IF NOT EXISTS blocked_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 기본 차단 사이트
    db.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES ('youtube.com')`);
    db.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES ('twitch.tv')`);
});

// API Routes

// GET /api/pcs - 모든 PC 상태 조회
app.get('/api/pcs', (req, res) => {
    db.all(`SELECT * FROM pc_status ORDER BY pc_name`, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// POST /api/pcs/:name/command - PC에 명령 전송
app.post('/api/pcs/:name/command', (req, res) => {
    const { name } = req.params;
    const { command, params } = req.body;

    // Socket으로 명령 전송
    io.emit(`command-${name}`, { command, params });

    res.json({ success: true, message: `Command sent to ${name}` });
});

// POST /api/pcs/:name/status - PC 상태 업데이트 (HTTP 방식)
app.post('/api/pcs/:name/status', (req, res) => {
    const { name } = req.params;
    const { pcName, ipAddress, cpuUsage, memoryUsage } = req.body;

    const actualPcName = pcName || name;

    db.run(`INSERT OR REPLACE INTO pc_status (pc_name, ip_address, cpu_usage, memory_usage, status, last_seen) 
            VALUES (?, ?, ?, ?, 'online', datetime('now'))`,
        [actualPcName, ipAddress, cpuUsage, memoryUsage],
        (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            // 모든 연결된 클라이언트에 업데이트 브로드캐스트
            io.emit('pc-updated', { pcName: actualPcName, ipAddress, cpuUsage, memoryUsage });

            res.json({ success: true });
        }
    );
});

// GET /api/logs - 활동 로그 조회
app.get('/api/logs', (req, res) => {
    const { pc_name, limit = 100 } = req.query;

    let query = 'SELECT * FROM activity_logs';
    const queryParams = [];

    if (pc_name) {
        query += ' WHERE pc_name = ?';
        queryParams.push(pc_name);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    queryParams.push(parseInt(limit));

    db.all(query, queryParams, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// GET /api/stats - 전체 통계
app.get('/api/stats', (req, res) => {
    const stats = {};

    db.get('SELECT COUNT(*) as total FROM pc_status', (err, row) => {
        stats.totalPCs = row?.total || 0;

        db.get(`SELECT COUNT(*) as online FROM pc_status 
                WHERE status = 'online' AND 
                datetime(last_seen) > datetime('now', '-5 minutes')`,
            (err, row) => {
                stats.onlinePCs = row?.online || 0;

                db.get('SELECT COUNT(*) as activities FROM activity_logs WHERE DATE(timestamp) = DATE("now")',
                    (err, row) => {
                        stats.todayActivities = row?.activities || 0;

                        res.json(stats);
                    });
            });
    });
});

// POST /api/deploy - 원격 PC에 시스템 배포
app.post('/api/deploy', (req, res) => {
    const { targetIP, username, password } = req.body;

    if (!targetIP || !username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: targetIP, username, password'
        });
    }

    // 배포 시작 알림
    io.emit('deploy-started', { targetIP, timestamp: new Date().toISOString() });

    // PowerShell 스크립트 실행
    const scriptPath = path.join(__dirname, '../../Remote-Deploy.ps1');
    const dashboardUrl = `http://${req.hostname}:${PORT}`;

    // PowerShell 명령 구성
    const psCommand = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -TargetIP "${targetIP}" -Username "${username}" -Password "${password}" -DashboardUrl "${dashboardUrl}"`;

    console.log(`[Deploy] Starting deployment to ${targetIP}...`);

    exec(psCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        let result;

        try {
            // PowerShell 스크립트가 JSON을 반환
            result = JSON.parse(stdout);
        } catch (e) {
            result = {
                Success: false,
                Message: error ? error.message : 'Unknown error',
                Output: stdout,
                Error: stderr
            };
        }

        if (result.Success) {
            console.log(`[Deploy] Successfully deployed to ${targetIP}`);
            io.emit('deploy-completed', {
                targetIP,
                success: true,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: `Successfully deployed to ${targetIP}`,
                details: result
            });
        } else {
            console.log(`[Deploy] Failed to deploy to ${targetIP}: ${result.Message}`);
            io.emit('deploy-completed', {
                targetIP,
                success: false,
                error: result.Message,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                success: false,
                error: result.Message,
                details: result
            });
        }
    });
});

// GET /api/deploy/check - 대상 PC 연결 확인
app.get('/api/deploy/check/:ip', (req, res) => {
    const { ip } = req.params;

    // ping 테스트
    const pingCmd = process.platform === 'win32'
        ? `ping -n 1 -w 1000 ${ip}`
        : `ping -c 1 -W 1 ${ip}`;

    exec(pingCmd, (error, stdout, stderr) => {
        const reachable = !error;
        res.json({
            ip,
            reachable,
            message: reachable ? 'PC is online' : 'PC is offline or unreachable'
        });
    });
});

// ========================================
// Authentication API
// ========================================

// POST /api/auth/login - 로그인
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`,
        [username, password], (err, user) => {
            if (err || !user) {
                return res.status(401).json({ success: false, error: 'Invalid credentials' });
            }
            res.json({
                success: true,
                user: { id: user.id, username: user.username, role: user.role }
            });
        });
});

// ========================================
// PC Groups API
// ========================================

// GET /api/groups - 그룹 목록
app.get('/api/groups', (req, res) => {
    db.all(`SELECT * FROM pc_groups ORDER BY name`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/groups - 그룹 생성
app.post('/api/groups', (req, res) => {
    const { name, description, policy } = req.body;
    db.run(`INSERT INTO pc_groups (name, description, policy) VALUES (?, ?, ?)`,
        [name, description, JSON.stringify(policy)], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        });
});

// PUT /api/pcs/:name/group - PC 그룹 할당
app.put('/api/pcs/:name/group', (req, res) => {
    const { name } = req.params;
    const { groupId } = req.body;
    db.run(`UPDATE pc_status SET group_id = ? WHERE pc_name = ?`, [groupId, name], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ========================================
// Screenshots API
// ========================================

// POST /api/screenshots - 스크린샷 저장
app.post('/api/screenshots', (req, res) => {
    const { pcName, filename, image } = req.body;
    const filepath = `screenshots/${pcName}/${filename}`;

    db.run(`INSERT INTO screenshots (pc_name, filename, filepath) VALUES (?, ?, ?)`,
        [pcName, filename, filepath], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        });
});

// GET /api/screenshots/:pcName - PC 스크린샷 목록
app.get('/api/screenshots/:pcName', (req, res) => {
    const { pcName } = req.params;
    db.all(`SELECT * FROM screenshots WHERE pc_name = ? ORDER BY captured_at DESC LIMIT 50`,
        [pcName], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

// ========================================
// Attendance API
// ========================================

// POST /api/attendance/checkin - 출석 체크
app.post('/api/attendance/checkin', (req, res) => {
    const { pcName } = req.body;
    const today = new Date().toISOString().split('T')[0];

    db.run(`INSERT OR IGNORE INTO attendance (pc_name, date, first_login) VALUES (?, ?, datetime('now'))`,
        [pcName, today], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, date: today });
        });
});

// GET /api/attendance - 출석 현황
app.get('/api/attendance', (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    db.all(`SELECT * FROM attendance WHERE date = ?`, [date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ========================================
// Blocked Sites API
// ========================================

// GET /api/blocked-sites - 차단 사이트 목록
app.get('/api/blocked-sites', (req, res) => {
    db.all(`SELECT * FROM blocked_sites ORDER BY url`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/blocked-sites - 사이트 차단 추가
app.post('/api/blocked-sites', (req, res) => {
    const { url } = req.body;
    db.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES (?)`, [url], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('sites-updated', { action: 'add', url });
        res.json({ success: true, id: this.lastID });
    });
});

// DELETE /api/blocked-sites/:id - 사이트 차단 해제
app.delete('/api/blocked-sites/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM blocked_sites WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('sites-updated', { action: 'remove', id });
        res.json({ success: true });
    });
});


// WebSocket 연결 처리
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // PC 에이전트 등록
    socket.on('register-pc', (data) => {
        const { pcName, ipAddress } = data;

        db.run(`INSERT OR REPLACE INTO pc_status (pc_name, ip_address, status, last_seen) 
                VALUES (?, ?, 'online', datetime('now'))`,
            [pcName, ipAddress],
            (err) => {
                if (err) console.error('Error registering PC:', err);

                // 모든 클라이언트에 업데이트 브로드캐스트
                io.emit('pc-updated', { pcName, status: 'online' });
            }
        );
    });

    // PC 상태 업데이트
    socket.on('update-status', (data) => {
        const { pcName, cpuUsage, memoryUsage } = data;

        db.run(`UPDATE pc_status 
                SET cpu_usage = ?, memory_usage = ?, status = 'online', last_seen = datetime('now')
                WHERE pc_name = ?`,
            [cpuUsage, memoryUsage, pcName]
        );

        io.emit('pc-updated', data);
    });

    // 활동 로그 추가
    socket.on('log-activity', (data) => {
        const { pcName, user, activityType, details } = data;

        db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details)
                VALUES (?, ?, ?, ?)`,
            [pcName, user, activityType, details]
        );

        io.emit('new-activity', data);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// 서버 시작
server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  ENTERPRISE PC MANAGEMENT DASHBOARD');
    console.log('========================================');
    console.log('');
    console.log(`Backend API running on http://localhost:${PORT}`);
    console.log('');
    console.log('API Endpoints:');
    console.log(`  GET  /api/pcs          - List all PCs`);
    console.log(`  POST /api/pcs/:name/command - Send command`);
    console.log(`  GET  /api/logs         - Activity logs`);
    console.log(`  GET  /api/stats        - Statistics`);
    console.log('');
    console.log('WebSocket: Real-time updates enabled');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    db.close();
    server.close();
    process.exit(0);
});
