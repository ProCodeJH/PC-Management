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

    return router;
};
