// utils/db.js
// Phase 11: Promisified SQLite wrapper with prepared statements,
// query timing, and connection health checks

const logger = require('./logger');

class DatabaseWrapper {
    constructor(db) {
        this.db = db;
        this.queryCount = 0;
        this.totalQueryTimeMs = 0;
        this.slowQueryThresholdMs = 100;
    }

    // Promisified db.run — returns { lastID, changes }
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            const start = process.hrtime.bigint();
            this.db.run(sql, params, function (err) {
                const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
                if (err) {
                    logger.error(`DB run error: ${err.message}`, { sql: sql.substring(0, 100), durationMs });
                    return reject(err);
                }
                resolve({ lastID: this.lastID, changes: this.changes });
            });
            this._trackQuery(sql);
        });
    }

    // Promisified db.get — returns single row or null
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            const start = process.hrtime.bigint();
            this.db.get(sql, params, (err, row) => {
                const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
                this._logSlow(sql, durationMs);
                if (err) {
                    logger.error(`DB get error: ${err.message}`, { sql: sql.substring(0, 100), durationMs });
                    return reject(err);
                }
                resolve(row || null);
            });
        });
    }

    // Promisified db.all — returns array of rows
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            const start = process.hrtime.bigint();
            this.db.all(sql, params, (err, rows) => {
                const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
                this._logSlow(sql, durationMs);
                if (err) {
                    logger.error(`DB all error: ${err.message}`, { sql: sql.substring(0, 100), durationMs });
                    return reject(err);
                }
                resolve(rows || []);
            });
        });
    }

    // Execute raw command (for PRAGMA, CREATE TABLE, etc.)
    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    // Health check — quick SELECT 1
    async healthCheck() {
        try {
            const start = Date.now();
            await this.get('SELECT 1 as ok');
            return { status: 'ok', latencyMs: Date.now() - start };
        } catch (err) {
            return { status: 'error', error: err.message };
        }
    }

    // Query metrics
    metrics() {
        return {
            totalQueries: this.queryCount,
            avgQueryTimeMs: this.queryCount > 0
                ? (this.totalQueryTimeMs / this.queryCount).toFixed(2)
                : 0,
        };
    }

    // Paginated query helper
    async paginate(baseSql, countSql, params = [], page = 1, limit = 20) {
        const offset = (page - 1) * limit;
        const [rows, countRow] = await Promise.all([
            this.all(`${baseSql} LIMIT ? OFFSET ?`, [...params, limit, offset]),
            this.get(countSql, params),
        ]);
        const total = countRow?.total || countRow?.count || 0;
        return {
            data: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page * limit < total,
                hasPrev: page > 1,
            },
        };
    }

    // Transaction helper
    async transaction(fn) {
        await this.run('BEGIN TRANSACTION');
        try {
            const result = await fn(this);
            await this.run('COMMIT');
            return result;
        } catch (err) {
            await this.run('ROLLBACK');
            throw err;
        }
    }

    // Close
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => err ? reject(err) : resolve());
        });
    }

    // Internal helpers
    _trackQuery(sql) {
        this.queryCount++;
    }

    _logSlow(sql, durationMs) {
        this.queryCount++;
        this.totalQueryTimeMs += durationMs;
        if (durationMs > this.slowQueryThresholdMs) {
            logger.warn(`Slow query (${durationMs.toFixed(1)}ms): ${sql.substring(0, 120)}`);
        }
    }
}

module.exports = DatabaseWrapper;
