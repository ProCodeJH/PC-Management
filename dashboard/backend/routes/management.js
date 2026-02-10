// routes/management.js
// CRUD routes for Groups, Screenshots, Attendance, Blocked Sites

const express = require('express');
const router = express.Router();

module.exports = function ({ db, io, authenticateToken }) {

    // ========================================
    // PC Groups
    // ========================================

    router.get('/groups', (req, res) => {
        db.all(`SELECT * FROM pc_groups ORDER BY name`, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    router.post('/groups', authenticateToken, (req, res) => {
        const { name, description, policy } = req.body;
        db.run(`INSERT INTO pc_groups (name, description, policy) VALUES (?, ?, ?)`,
            [name, description, JSON.stringify(policy)], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id: this.lastID });
            });
    });

    router.put('/pcs/:name/group', authenticateToken, (req, res) => {
        const { name } = req.params;
        const { groupId } = req.body;
        db.run(`UPDATE pc_status SET group_id = ? WHERE pc_name = ?`, [groupId, name], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
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

    // ========================================
    // Attendance
    // ========================================

    router.post('/attendance/checkin', (req, res) => {
        const { pcName } = req.body;
        const today = new Date().toISOString().split('T')[0];

        db.run(`INSERT OR IGNORE INTO attendance (pc_name, date, first_login) VALUES (?, ?, datetime('now'))`,
            [pcName, today], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, date: today });
            });
    });

    router.get('/attendance', (req, res) => {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        db.all(`SELECT * FROM attendance WHERE date = ?`, [date], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // ========================================
    // Blocked Sites
    // ========================================

    router.get('/blocked-sites', (req, res) => {
        db.all(`SELECT * FROM blocked_sites ORDER BY url`, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    router.post('/blocked-sites', authenticateToken, (req, res) => {
        const { url } = req.body;
        db.run(`INSERT OR IGNORE INTO blocked_sites (url) VALUES (?)`, [url], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('sites-updated', { action: 'add', url });
            res.json({ success: true, id: this.lastID });
        });
    });

    router.delete('/blocked-sites/:id', authenticateToken, (req, res) => {
        const { id } = req.params;
        db.run(`DELETE FROM blocked_sites WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('sites-updated', { action: 'remove', id });
            res.json({ success: true });
        });
    });

    return router;
};
