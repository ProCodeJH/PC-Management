// routes/management.js
// CRUD routes for Groups, Screenshots, Attendance, Blocked Sites

const express = require('express');
const router = express.Router();

module.exports = function ({ db, io, authenticateToken, pcSockets }) {

    // Helper: emit to all connected agents via pcSockets (reliable)
    function emitToAllAgents(eventPrefix, data) {
        pcSockets.forEach((socketId, pcName) => {
            const s = io.sockets.sockets.get(socketId);
            if (s) s.emit(`${eventPrefix}-${pcName}`, data);
        });
    }

    // Full reconciliation: send complete desired state to every agent.
    // Called after any blocked-site mutation so clients always reach desired state.
    function broadcastBlockedSitesSync() {
        db.all(`SELECT url FROM blocked_sites ORDER BY url`, (err, rows) => {
            if (err) return;
            const domains = rows.map(r => r.url);
            emitToAllAgents('sync-blocked-sites', { domains });
        });
    }

    function broadcastBlockedProgramsSync() {
        db.all(`SELECT DISTINCT program_name FROM blocked_programs`, (err, rows) => {
            if (err) return;
            const programs = rows.map(r => r.program_name);
            emitToAllAgents('sync-blocked-programs', { programs });
        });
    }

    // Expose on router so server.js can call these after DB mutations elsewhere
    router.broadcastBlockedSitesSync = broadcastBlockedSitesSync;
    router.broadcastBlockedProgramsSync = broadcastBlockedProgramsSync;

    // ========================================
    // PC Groups — DEPRECATED (feature removed per user feedback)
    // Endpoints return 410 Gone so clients know the feature is removed.
    // DB tables are preserved to avoid data loss.
    // ========================================

    router.get('/groups', authenticateToken, (req, res) => {
        res.json([]); // empty list — feature removed
    });

    router.post('/groups', authenticateToken, (req, res) => {
        res.status(410).json({ error: 'Groups feature removed' });
    });

    router.put('/pcs/:name/group', authenticateToken, (req, res) => {
        res.status(410).json({ error: 'Groups feature removed' });
    });

    // ========================================
    // Screenshots
    // ========================================

    router.post('/screenshots', authenticateToken, (req, res) => {
        const { pcName, filename, image } = req.body;
        const filepath = `screenshots/${pcName}/${filename}`;

        db.run(`INSERT INTO screenshots (pc_name, filename, filepath) VALUES (?, ?, ?)`,
            [pcName, filename, filepath], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id: this.lastID });
            });
    });

    router.get('/screenshots/:pcName', authenticateToken, (req, res) => {
        const { pcName } = req.params;
        db.all(`SELECT * FROM screenshots WHERE pc_name = ? ORDER BY captured_at DESC LIMIT 50`,
            [pcName], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows);
            });
    });

    // GET /api/screenshots — all screenshots, optionally filtered by reason
    router.get('/screenshots', authenticateToken, (req, res) => {
        const reason = req.query.reason;
        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        let sql = `SELECT id, pc_name, filename, reason, program, file_size, captured_at FROM screenshots`;
        const params = [];
        if (reason) {
            sql += ` WHERE reason = ?`;
            params.push(reason);
        }
        sql += ` ORDER BY captured_at DESC LIMIT ?`;
        params.push(limit);
        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    // GET /api/screenshots/image/:id — serves the actual JPG file
    router.get('/screenshots/image/:id', authenticateToken, (req, res) => {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ error: 'bad id' });
        db.get(`SELECT filepath FROM screenshots WHERE id = ?`, [id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'not found' });
            const fs = require('fs');
            const path = require('path');
            // Resolve + check filepath is within screenshots directory (path traversal protection)
            const normalized = path.normalize(row.filepath);
            if (!normalized.includes('screenshots')) return res.status(403).json({ error: 'bad path' });
            if (!fs.existsSync(normalized)) return res.status(404).json({ error: 'file gone' });
            res.sendFile(normalized);
        });
    });

    // ========================================
    // Attendance — DEPRECATED (feature removed per user feedback)
    // ========================================

    router.post('/attendance/checkin', authenticateToken, (req, res) => {
        res.status(410).json({ error: 'Attendance feature removed' });
    });

    router.get('/attendance', authenticateToken, (req, res) => {
        res.json([]); // empty — feature removed
    });

    // ========================================
    // Blocked Sites
    // ========================================

    router.get('/blocked-sites', authenticateToken, (req, res) => {
        db.all(`SELECT * FROM blocked_sites ORDER BY url`, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    router.post('/blocked-sites', authenticateToken, (req, res) => {
        const { url } = req.body;
        if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
        const cleanUrl = url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (cleanUrl.endsWith('.exe') || !/\./.test(cleanUrl) || cleanUrl.includes(' ')) {
            return res.status(400).json({ error: 'Invalid domain. Use program blocking for .exe files.' });
        }
        db.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES (?)`, [cleanUrl], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            db.get(`SELECT id FROM blocked_sites WHERE url = ?`, [cleanUrl], (e2, row) => {
                const siteId = row ? row.id : 0;
                // Full reconciliation: broadcast complete desired state
                broadcastBlockedSitesSync();
                io.emit('sites-updated', { action: 'add', url: cleanUrl });
                res.json({ success: true, data: { id: siteId, url: cleanUrl } });
            });
        });
    });

    router.delete('/blocked-sites/:id', authenticateToken, (req, res) => {
        const { id } = req.params;
        db.get(`SELECT url FROM blocked_sites WHERE id = ?`, [id], (e1, site) => {
            if (e1) return res.status(500).json({ error: e1.message });
            if (!site) return res.status(404).json({ error: 'Site not found' });
            db.run(`DELETE FROM blocked_sites WHERE id = ?`, [id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                // Full reconciliation: broadcast complete desired state
                broadcastBlockedSitesSync();
                io.emit('sites-updated', { action: 'remove', id });
                res.json({ success: true });
            });
        });
    });

    // Bulk clear all blocked sites — admin emergency "해제 전부" button
    router.delete('/blocked-sites', authenticateToken, (req, res) => {
        db.run(`DELETE FROM blocked_sites`, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            broadcastBlockedSitesSync();
            io.emit('sites-updated', { action: 'clear' });
            res.json({ success: true });
        });
    });

    return router;
};
