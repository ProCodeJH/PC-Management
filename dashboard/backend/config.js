// config.js
// v20.0 — Centralized configuration for all 20 phases
// All tunables in one place — no magic numbers

require('dotenv').config();
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    // Server
    PORT: parseInt(process.env.PORT, 10) || 3001,
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_PRODUCTION: isProduction,

    // Security
    SALT_ROUNDS: 12,
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3001',
    DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
    PASSWORD_MIN_LENGTH: 8,
    MAX_LOGIN_ATTEMPTS: 5,
    ACCOUNT_LOCK_DURATION_MS: 15 * 60 * 1000,

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,  // 15 minutes
    RATE_LIMIT_MAX: isProduction ? 100 : 500,
    LOGIN_RATE_LIMIT_MAX: 5,

    // Database
    DB_PATH: path.join(__dirname, 'enterprise-pc.db'),
    DB_CACHE_SIZE: -16000,       // 16MB in-memory page cache (up from 8MB)
    DB_SYNCHRONOUS: 'NORMAL',
    DB_MMAP_SIZE: 536870912,     // 512MB mmap (up from 256MB)
    DB_BUSY_TIMEOUT: 5000,       // 5s busy timeout

    // Cache
    CACHE_MAX_SIZE: 500,
    CACHE_TTL_PCS: 3000,         // 3s
    CACHE_TTL_STATS: 5000,       // 5s
    CACHE_TTL_BLOCKED: 30000,    // 30s
    CACHE_TTL_GROUPS: 15000,     // 15s
    CACHE_TTL_CREDENTIALS: 10000, // 10s

    // Network scan
    SCAN_BATCH_SIZE: 100,        // concurrent pings (up from 50)
    SCAN_PING_TIMEOUT_MS: 150,   // per-IP timeout (down from 200)

    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    LOG_DIR: path.join(__dirname, 'logs'),
    LOG_MAX_FILES: '30d',

    // Scheduler
    PC_HEALTH_CHECK_INTERVAL_MS: 60000,      // 1min
    LOG_CLEANUP_INTERVAL_MS: 3600000,        // 1hr
    LOG_RETENTION_DAYS: 30,
    CACHE_WARM_INTERVAL_MS: 30000,           // 30s

    // Uploads
    SCREENSHOT_MAX_SIZE: 10 * 1024 * 1024,   // 10MB
    FILE_MAX_SIZE: 50 * 1024 * 1024,         // 50MB

    // Cluster
    MAX_WORKERS: parseInt(process.env.MAX_WORKERS, 10) || 4,

    // WebSocket
    WS_MAX_CONNECTIONS_PER_IP: 10,
    WS_RATE_LIMIT_PER_SECOND: 30,

    // Metrics
    METRICS_ENABLED: true,
    METRICS_HISTORY_SIZE: 1000,

    // API
    API_VERSION: 'v1',
    REQUEST_TIMEOUT_MS: 30000,

    // Supabase Mirroring (optional — best-effort)
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    SUPABASE_MIRROR_ENABLED: !!process.env.SUPABASE_URL,
    SUPABASE_BATCH_INTERVAL_MS: 60000,  // 1min activity log batch
};
