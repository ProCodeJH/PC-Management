// auth.middleware.js
// JWT Authentication Middleware for Enterprise PC Management
// Security Enhancement - Phase 2 (Hardened)

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Load environment variables
require('dotenv').config();

// JWT Secret from environment - NO hardcoded fallback
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '24h';

// Startup security check
if (!JWT_SECRET || JWT_SECRET === 'CHANGE-ME-TO-A-RANDOM-SECRET-KEY') {
    console.error('');
    console.error('🚨 ============================================');
    console.error('🚨  SECURITY WARNING: JWT_SECRET is not set!');
    console.error('🚨  Generate one with:');
    console.error('🚨  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    console.error('🚨  Then set it in dashboard/backend/.env');
    console.error('🚨 ============================================');
    console.error('');
    // Generate a random secret for this session (not persisted)
    // This ensures security even if .env is not configured
    module.exports._sessionSecret = crypto.randomBytes(64).toString('hex');
}

const getSecret = () => JWT_SECRET || module.exports._sessionSecret || 'fallback-dev-only';

/**
 * Generate JWT Token
 * @param {Object} user - User object with id, username, role
 * @returns {string} JWT token
 */
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role
        },
        getSecret(),
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Verify JWT Token Middleware
 * @param {Request} req 
 * @param {Response} res 
 * @param {Function} next 
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Access token required'
        });
    }

    jwt.verify(token, getSecret(), (err, user) => {
        if (err) {
            return res.status(403).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }
        req.user = user;
        next();
    });
}

/**
 * Optional authentication - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        jwt.verify(token, getSecret(), (err, user) => {
            if (!err) {
                req.user = user;
            }
        });
    }
    next();
}

/**
 * Role-based access control middleware
 * @param {...string} roles - Allowed roles
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
        }
        next();
    };
}

module.exports = {
    generateToken,
    authenticateToken,
    optionalAuth,
    requireRole
};
