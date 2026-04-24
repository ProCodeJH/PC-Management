// error.middleware.js
// Centralized error handling — consistent JSON error responses

/**
 * Express error-handling middleware (must have 4 args).
 * Catches unhandled errors thrown/passed via next(err) in route handlers.
 */
function errorHandler(err, req, res, next) {
    // Log full error server-side
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message || err);
    if (err.stack) {
        console.error(err.stack);
    }

    const statusCode = err.statusCode || 500;
    const message = statusCode === 500
        ? 'Internal server error'
        : err.message || 'Something went wrong';

    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
}

/**
 * 404 handler — mount AFTER all routes
 */
function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: `Route not found: ${req.method} ${req.originalUrl}`
    });
}

module.exports = { errorHandler, notFoundHandler };
