// routes/auth.js
// Authentication routes - Login with JWT + bcrypt

const express = require('express');
const router = express.Router();

module.exports = function ({ db, bcrypt, generateToken, SALT_ROUNDS }) {

    // POST /api/auth/login
    router.post('/login', async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }

        db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
            if (err) {
                console.error('Login DB error:', err);
                return res.status(500).json({ success: false, error: 'Database error' });
            }

            if (!user) {
                return res.status(401).json({ success: false, error: 'Invalid credentials' });
            }

            try {
                let isValid = false;
                if (user.password_hash) {
                    isValid = await bcrypt.compare(password, user.password_hash);
                } else if (user.password === password) {
                    // Legacy plaintext password match - hash it for future use
                    isValid = true;
                    const hash = await bcrypt.hash(password, SALT_ROUNDS);
                    db.run(`UPDATE users SET password_hash = ?, password = NULL WHERE id = ?`, [hash, user.id]);
                }

                if (!isValid) {
                    return res.status(401).json({ success: false, error: 'Invalid credentials' });
                }

                const token = generateToken({
                    id: user.id,
                    username: user.username,
                    role: user.role
                });

                res.json({
                    success: true,
                    token,
                    user: { id: user.id, username: user.username, role: user.role }
                });
            } catch (error) {
                console.error('Login error:', error);
                res.status(500).json({ success: false, error: 'Authentication error' });
            }
        });
    });

    // POST /api/auth/change-password
    router.post('/change-password', async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: '현재 비밀번호와 새 비밀번호를 입력하세요' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ success: false, error: '비밀번호는 4자 이상이어야 합니다' });
        }

        db.get('SELECT * FROM users WHERE username = ?', ['admin'], async (err, user) => {
            if (err || !user) return res.status(500).json({ success: false, error: 'DB 오류' });

            let valid = false;
            if (user.password_hash) {
                valid = await bcrypt.compare(currentPassword, user.password_hash);
            } else if (user.password === currentPassword) {
                valid = true;
            }

            if (!valid) {
                return res.status(401).json({ success: false, error: '현재 비밀번호가 틀립니다' });
            }

            const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
            db.run('UPDATE users SET password_hash = ?, password = NULL WHERE id = ?', [hash, user.id], (err2) => {
                if (err2) return res.status(500).json({ success: false, error: 'DB 업데이트 실패' });
                res.json({ success: true, message: '비밀번호가 변경되었습니다' });
            });
        });
    });

    return router;
};
