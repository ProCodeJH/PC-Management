// routes/tokens.js
// Installation token management + auto-installer generation
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

module.exports = function ({ db, authenticateToken, requireRole }) {
    const router = express.Router();

    function getServerLanIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) return iface.address;
            }
        }
        return 'localhost';
    }

    // POST /generate — create token + return download info
    router.post('/generate', authenticateToken, requireRole('admin'), (req, res) => {
        const { label, expiresInHours = 72, maxUses = 30 } = req.body;
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
        const config = require('../config');
        const serverUrl = `http://${getServerLanIP()}:${config.PORT}`;

        db.run(
            `INSERT INTO deployment_tokens (token, label, created_by, expires_at, max_uses, use_count)
             VALUES (?, ?, ?, ?, ?, 0)`,
            [token, label || 'agent-install', req.user.username, expiresAt, maxUses],
            function (err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({
                    success: true,
                    token,
                    id: this.lastID,
                    expiresAt,
                    maxUses,
                    serverUrl,
                    installCommand: `powershell -ExecutionPolicy Bypass -Command "irm ${serverUrl}/install/${token} | iex"`,
                });
            }
        );
    });

    // POST /generate-bulk
    router.post('/generate-bulk', authenticateToken, requireRole('admin'), (req, res) => {
        const { count = 10, expiresInHours = 72, label } = req.body;
        const tokens = [];
        const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
        const config = require('../config');
        const serverUrl = `http://${getServerLanIP()}:${config.PORT}`;

        const stmt = db.prepare(
            `INSERT INTO deployment_tokens (token, label, created_by, expires_at, max_uses, use_count) VALUES (?, ?, ?, ?, 1, 0)`
        );
        for (let i = 0; i < Math.min(count, 100); i++) {
            const token = crypto.randomBytes(32).toString('hex');
            stmt.run([token, label || `batch-${i + 1}`, req.user.username, expiresAt]);
            tokens.push(token);
        }
        stmt.finalize();
        res.json({ success: true, tokens, count: tokens.length, expiresAt, serverUrl });
    });

    // GET / — list all tokens
    router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
        db.all(
            `SELECT id, token, label, created_by, created_at, expires_at, max_uses, use_count, revoked
             FROM deployment_tokens ORDER BY created_at DESC LIMIT 100`,
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                const now = new Date().toISOString();
                const enriched = rows.map(r => ({
                    ...r,
                    status: r.revoked ? 'revoked' : r.expires_at < now ? 'expired' : r.use_count >= r.max_uses ? 'used' : 'active',
                }));
                res.json({ success: true, tokens: enriched });
            }
        );
    });

    // DELETE /:id — revoke
    router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
        db.run(`UPDATE deployment_tokens SET revoked = 1 WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, error: 'Token not found' });
            res.json({ success: true, message: 'Token revoked' });
        });
    });

    // POST /validate — agent registration (no JWT)
    router.post('/validate', (req, res) => {
        const { token, pcName, ipAddress } = req.body;
        if (!token || !pcName) return res.status(400).json({ success: false, error: 'token and pcName required' });

        db.get(`SELECT * FROM deployment_tokens WHERE token = ? AND revoked = 0`, [token], (err, row) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (!row) return res.status(401).json({ success: false, error: 'Invalid token' });
            if (row.expires_at < new Date().toISOString()) return res.status(401).json({ success: false, error: 'Token expired' });
            if (row.use_count >= row.max_uses) return res.status(401).json({ success: false, error: 'Token max uses reached' });

            const agentKey = crypto.randomBytes(32).toString('hex');
            db.run(`UPDATE deployment_tokens SET use_count = use_count + 1 WHERE id = ?`, [row.id]);
            db.run(
                `INSERT OR REPLACE INTO registered_agents (pc_name, ip_address, agent_key, token_id, status, registered_at, last_seen)
                 VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
                [pcName, ipAddress, agentKey, row.id],
                (err2) => {
                    if (err2) return res.status(500).json({ success: false, error: err2.message });
                    res.json({ success: true, agentKey, message: 'Agent registered' });
                }
            );
        });
    });

    // Shared helper
    router.validateAgentKey = function (agentKey, pcName, callback) {
        if (!agentKey || !pcName) return callback(false);
        db.get(`SELECT * FROM registered_agents WHERE agent_key = ? AND pc_name = ? AND status = 'active'`, [agentKey, pcName], (err, row) => {
            if (err || !row) return callback(false);
            db.run(`UPDATE registered_agents SET last_seen = datetime('now') WHERE id = ?`, [row.id]);
            callback(true, row);
        });
    };

    return router;
};
