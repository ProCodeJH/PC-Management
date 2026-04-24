// utils/upload.js
// Phase 17: Secure file upload middleware with multer
// Handles screenshots + file transfers with size/type validation

const path = require('path');
const fs = require('fs');

let multer;
try {
    multer = require('multer');
} catch (e) {
    // Fallback when multer isn't installed
    module.exports = {
        screenshotUpload: (req, res, next) => next(),
        fileUpload: (req, res, next) => next(),
    };
    return;
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

// Ensure directories exist
[UPLOAD_DIR, SCREENSHOT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Allowed MIME types
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
const FILE_TYPES = [...IMAGE_TYPES, 'application/zip', 'application/x-zip-compressed',
    'application/pdf', 'text/plain', 'application/octet-stream'];

// File filter factory
function fileFilter(allowedTypes) {
    return (req, file, cb) => {
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`), false);
        }
    };
}

// Sanitize filename — prevent path traversal
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/\.{2,}/g, '.')
        .substring(0, 200);
}

// Storage for screenshots
const screenshotStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const pcDir = path.join(SCREENSHOT_DIR, sanitizeFilename(req.params.pcName || 'unknown'));
        if (!fs.existsSync(pcDir)) fs.mkdirSync(pcDir, { recursive: true });
        cb(null, pcDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const name = `screenshot_${Date.now()}${ext}`;
        cb(null, name);
    },
});

// Storage for general file uploads
const fileStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const safeName = sanitizeFilename(file.originalname);
        cb(null, `${Date.now()}_${safeName}`);
    },
});

// Export configured uploaders
module.exports = {
    screenshotUpload: multer({
        storage: screenshotStorage,
        limits: { fileSize: 10 * 1024 * 1024 },  // 10MB
        fileFilter: fileFilter(IMAGE_TYPES),
    }),
    fileUpload: multer({
        storage: fileStorage,
        limits: { fileSize: 50 * 1024 * 1024 },  // 50MB
        fileFilter: fileFilter(FILE_TYPES),
    }),
    sanitizeFilename,
    UPLOAD_DIR,
    SCREENSHOT_DIR,
};
