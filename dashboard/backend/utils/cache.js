// utils/cache.js
// Phase 12: Advanced LRU cache with TTL, metrics, ETag, warming
// Upgraded from Phase 7 basic TTL cache

class LRUCache {
    constructor(maxSize = 200) {
        this.store = new Map();
        this.maxSize = maxSize;
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.store.delete(key);
            this.misses++;
            return null;
        }
        // Move to end (most recently used)
        this.store.delete(key);
        this.store.set(key, entry);
        this.hits++;
        return entry.value;
    }

    set(key, value, ttlMs = 5000) {
        // Evict LRU if at capacity
        if (this.store.size >= this.maxSize && !this.store.has(key)) {
            const firstKey = this.store.keys().next().value;
            this.store.delete(firstKey);
            this.evictions++;
        }

        this.store.set(key, {
            value,
            expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
            etag: this._generateETag(value),
            cachedAt: Date.now(),
        });
    }

    // Check ETag match
    hasETag(key, clientETag) {
        const entry = this.store.get(key);
        if (!entry) return false;
        if (entry.expiresAt && Date.now() > entry.expiresAt) return false;
        return entry.etag === clientETag;
    }

    getETag(key) {
        const entry = this.store.get(key);
        return entry?.etag || null;
    }

    invalidate(key) {
        this.store.delete(key);
    }

    invalidatePattern(pattern) {
        const regex = new RegExp(pattern);
        for (const key of this.store.keys()) {
            if (regex.test(key)) this.store.delete(key);
        }
    }

    clear() {
        this.store.clear();
    }

    // Warm cache with data
    warm(entries) {
        for (const { key, value, ttlMs } of entries) {
            this.set(key, value, ttlMs);
        }
    }

    stats() {
        const total = this.hits + this.misses;
        return {
            size: this.store.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%',
        };
    }

    // ETag middleware for GET endpoints
    etagMiddleware(keyFn) {
        return (req, res, next) => {
            const key = typeof keyFn === 'function' ? keyFn(req) : keyFn;
            const clientETag = req.headers['if-none-match'];

            if (clientETag && this.hasETag(key, clientETag)) {
                return res.status(304).end();
            }

            // Patch res.json to add ETag header
            const originalJson = res.json.bind(res);
            res.json = (data) => {
                const etag = this.getETag(key);
                if (etag) res.setHeader('ETag', `"${etag}"`);
                return originalJson(data);
            };

            next();
        };
    }

    _generateETag(value) {
        try {
            const crypto = require('crypto');
            const str = typeof value === 'string' ? value : JSON.stringify(value);
            return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
        } catch {
            return Date.now().toString(36);
        }
    }
}

module.exports = new LRUCache(500);
