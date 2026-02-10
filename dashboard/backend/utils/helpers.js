// utils/helpers.js
// Shared input validation and sanitization helpers

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]{0,63}$/;

/**
 * Validate an IPv4 address string (0-255 per octet)
 */
function isValidIP(ip) {
    if (!ip || !IP_REGEX.test(ip)) return false;
    const parts = ip.split('.').map(Number);
    return parts.every(p => p >= 0 && p <= 255);
}

/**
 * Validate a hostname or IPv4 address
 */
function isValidHostnameOrIP(value) {
    return isValidIP(value) || HOSTNAME_REGEX.test(value);
}

/**
 * Strip dangerous PowerShell metacharacters to prevent injection
 */
function sanitizeForPS(str) {
    if (!str) return '';
    return str.replace(/[;`|&$(){}\[\]]/g, '');
}

module.exports = { isValidIP, isValidHostnameOrIP, sanitizeForPS };
