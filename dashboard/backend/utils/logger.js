// utils/logger.js
// Phase 8: Structured logging with winston
// Supports console + file rotation + request timing

const path = require('path');

let winston, DailyRotateFile;
try {
    winston = require('winston');
    DailyRotateFile = require('winston-daily-rotate-file');
} catch (e) {
    // Fallback to console-based logger if winston not installed
    const fallback = {
        info: (...args) => console.log('[INFO]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        error: (...args) => console.error('[ERROR]', ...args),
        debug: (...args) => console.debug('[DEBUG]', ...args),
        http: (...args) => console.log('[HTTP]', ...args),
    };
    fallback.requestLogger = () => (req, res, next) => next();
    fallback.child = () => fallback;
    module.exports = fallback;
    return;
}

const config = require('../config');
const LOG_DIR = path.join(__dirname, '..', 'logs');

// Custom format: timestamp [level] message {meta}
const customFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}${stack ? '\n' + stack : ''}${metaStr}`;
    })
);

const colorFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length && !meta.stack ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level} ${message}${metaStr}`;
    })
);

// Transports
const transports = [
    // Console — colorized, concise
    new winston.transports.Console({
        level: config.LOG_LEVEL || 'info',
        format: colorFormat,
    }),
];

// File rotation — only if winston-daily-rotate-file available
if (DailyRotateFile) {
    transports.push(
        // Combined log — all levels
        new DailyRotateFile({
            dirname: LOG_DIR,
            filename: 'combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '10m',
            maxFiles: '14d',
            level: 'info',
            format: customFormat,
        }),
        // Error log — errors only
        new DailyRotateFile({
            dirname: LOG_DIR,
            filename: 'error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '10m',
            maxFiles: '30d',
            level: 'error',
            format: customFormat,
        })
    );
}

const logger = winston.createLogger({
    level: config.LOG_LEVEL || 'info',
    format: customFormat,
    transports,
    exitOnError: false,
});

// Request logging middleware — tracks response time
logger.requestLogger = () => {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        const reqId = req.headers['x-request-id'] || generateRequestId();
        req.requestId = reqId;
        res.setHeader('X-Request-Id', reqId);

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
            const logData = {
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration: `${durationMs.toFixed(1)}ms`,
                ip: req.ip,
                reqId,
            };

            if (res.statusCode >= 500) {
                logger.error(`${req.method} ${req.originalUrl} ${res.statusCode}`, logData);
            } else if (res.statusCode >= 400) {
                logger.warn(`${req.method} ${req.originalUrl} ${res.statusCode}`, logData);
            } else {
                logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
            }
        });

        next();
    };
};

// Child logger factory
logger.child = (meta) => {
    return logger.child ? winston.createLogger({
        ...logger,
        defaultMeta: meta,
    }) : logger;
};

let reqCounter = 0;
function generateRequestId() {
    return `req_${Date.now().toString(36)}_${(++reqCounter).toString(36)}`;
}

module.exports = logger;
