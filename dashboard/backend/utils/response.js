// utils/response.js
// Phase 13: Standardized API response helper
// All responses follow: { success, data?, error?, meta? }

class ApiResponse {
    // Success response
    static ok(res, data = null, meta = {}) {
        const response = { success: true };
        if (data !== null && data !== undefined) response.data = data;
        if (Object.keys(meta).length > 0) response.meta = meta;
        return res.json(response);
    }

    // Created (201)
    static created(res, data = null, meta = {}) {
        const response = { success: true };
        if (data !== null) response.data = data;
        if (Object.keys(meta).length > 0) response.meta = meta;
        return res.status(201).json(response);
    }

    // Paginated response
    static paginated(res, data, pagination) {
        return res.json({
            success: true,
            data,
            meta: { pagination },
        });
    }

    // Error responses
    static badRequest(res, message = 'Bad request', details = null) {
        const response = { success: false, error: message };
        if (details) response.details = details;
        return res.status(400).json(response);
    }

    static unauthorized(res, message = 'Unauthorized') {
        return res.status(401).json({ success: false, error: message });
    }

    static forbidden(res, message = 'Forbidden') {
        return res.status(403).json({ success: false, error: message });
    }

    static notFound(res, message = 'Resource not found') {
        return res.status(404).json({ success: false, error: message });
    }

    static conflict(res, message = 'Resource already exists') {
        return res.status(409).json({ success: false, error: message });
    }

    static tooMany(res, message = 'Too many requests') {
        return res.status(429).json({ success: false, error: message });
    }

    static serverError(res, message = 'Internal server error', err = null) {
        const response = { success: false, error: message };
        if (process.env.NODE_ENV !== 'production' && err) {
            response.stack = err.stack;
        }
        return res.status(500).json(response);
    }

    // ETag support for cacheable responses
    static withETag(res, data, maxAge = 0) {
        const crypto = require('crypto');
        const body = JSON.stringify(data);
        const etag = crypto.createHash('md5').update(body).digest('hex');

        res.setHeader('ETag', `"${etag}"`);
        if (maxAge > 0) {
            res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
        }

        return { success: true, data };
    }
}

module.exports = ApiResponse;
