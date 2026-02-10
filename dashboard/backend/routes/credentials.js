// routes/credentials.js
// Saved credentials management routes (AES-256-CBC encrypted)

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

module.exports = function ({ db, authenticateToken }) {

    // AES-256-CBC encryption
    const ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || crypto.randomBytes(16).toString('hex');
    const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

    const encryptPassword = (password) => {
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
        let encrypted = cipher.update(password, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    };

    const decryptPassword = (encryptedStr) => {
        try {
            // Handle legacy Base64 format migration
            if (encryptedStr.includes(':EPM-SECR') || !encryptedStr.includes(':')) {
                const base64 = encryptedStr.split(':')[0];
                return Buffer.from(base64, 'base64').toString('utf8');
            }
            const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
            const [ivHex, encrypted] = encryptedStr.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            console.error('Decryption failed:', e.message);
            return null;
        }
    };

    // GET /api/credentials - 저장된 자격 증명 목록
    router.get('/', authenticateToken, (req, res) => {
        db.all(`SELECT id, name, username, is_default, created_at FROM saved_credentials ORDER BY is_default DESC`, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // GET /api/credentials/default - 기본 자격 증명
    router.get('/default', authenticateToken, (req, res) => {
        db.get(`SELECT * FROM saved_credentials WHERE is_default = 1`, (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.json({ hasDefault: false });
            res.json({
                hasDefault: true,
                username: row.username,
                password: decryptPassword(row.password_encrypted)
            });
        });
    });

    // POST /api/credentials - 자격 증명 저장
    router.post('/', authenticateToken, (req, res) => {
        const { name, username, password, isDefault } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'username, password 필수' });
        }

        const encrypted = encryptPassword(password);

        if (isDefault) {
            db.run(`UPDATE saved_credentials SET is_default = 0`);
        }

        db.run(`INSERT INTO saved_credentials (name, username, password_encrypted, is_default) VALUES (?, ?, ?, ?)`,
            [name || 'default', username, encrypted, isDefault ? 1 : 0],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id: this.lastID });
            }
        );
    });

    // DELETE /api/credentials/:id - 자격 증명 삭제
    router.delete('/:id', authenticateToken, (req, res) => {
        db.run(`DELETE FROM saved_credentials WHERE id = ?`, [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // Export encrypt/decrypt for use by other modules
    router.encryptPassword = encryptPassword;
    router.decryptPassword = decryptPassword;

    return router;
};
