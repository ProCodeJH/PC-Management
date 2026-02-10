// utils/audit.js
// Phase 15: Security audit trail for sensitive operations
// Logs admin actions for compliance and forensics

const logger = require('./logger');

class AuditLog {
    constructor() {
        this.db = null;
    }

    init(db) {
        this.db = db;
        // Create audit table
        db.run(`CREATE TABLE IF NOT EXISTS audit_trail (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            actor TEXT,
            actor_ip TEXT,
            target TEXT,
            details TEXT,
            severity TEXT DEFAULT 'info',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_trail(actor)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_trail(action)`);
    }

    // Log an audit event
    log(action, { actor = 'system', actorIp = '', target = '', details = '', severity = 'info' } = {}) {
        if (!this.db) return;

        const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;

        this.db.run(
            `INSERT INTO audit_trail (action, actor, actor_ip, target, details, severity) VALUES (?, ?, ?, ?, ?, ?)`,
            [action, actor, actorIp, target, detailsStr, severity]
        );

        // Also log to structured logger
        logger.info(`AUDIT: ${action}`, { actor, actorIp, target, severity });
    }

    // Middleware: auto-log sensitive operations
    middleware(action, severity = 'info') {
        return (req, res, next) => {
            const originalEnd = res.end;
            res.end = (...args) => {
                if (res.statusCode < 400) {
                    this.log(action, {
                        actor: req.user?.username || 'anonymous',
                        actorIp: req.ip,
                        target: req.originalUrl,
                        details: { method: req.method, body: this._sanitizeBody(req.body) },
                        severity,
                    });
                }
                return originalEnd.apply(res, args);
            };
            next();
        };
    }

    // Remove sensitive fields before logging
    _sanitizeBody(body) {
        if (!body || typeof body !== 'object') return body;
        const sanitized = { ...body };
        const sensitive = ['password', 'password_hash', 'token', 'secret', 'key', 'credential'];
        for (const key of Object.keys(sanitized)) {
            if (sensitive.some(s => key.toLowerCase().includes(s))) {
                sanitized[key] = '[REDACTED]';
            }
        }
        return sanitized;
    }

    // Query audit logs
    async query(filters = {}) {
        if (!this.db) return [];
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM audit_trail';
            const params = [];
            const conditions = [];

            if (filters.actor) {
                conditions.push('actor = ?');
                params.push(filters.actor);
            }
            if (filters.action) {
                conditions.push('action = ?');
                params.push(filters.action);
            }
            if (filters.severity) {
                conditions.push('severity = ?');
                params.push(filters.severity);
            }
            if (filters.since) {
                conditions.push('timestamp >= ?');
                params.push(filters.since);
            }

            if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
            sql += ' ORDER BY timestamp DESC LIMIT ?';
            params.push(filters.limit || 100);

            this.db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }
}

module.exports = new AuditLog();
