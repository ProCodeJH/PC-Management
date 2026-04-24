// License verification module
// License format: base64(JSON).base64(HMAC-SHA256)
// Offline-capable — no server call needed

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Signing key (split for basic obfuscation)
const _k = ['4a61', '6879', '656f', '6e43', '6f64', '696e', '6753', '736f', '6b50', '434d'];
const SIGN_KEY = Buffer.from(_k.join(''), 'hex').toString() + '-license-v1';

function verifyLicense(licensePath) {
    const result = { valid: false, academy: '', maxPCs: 0, edition: '', expiry: '', serial: '', error: '' };

    if (!licensePath) licensePath = path.join(__dirname, 'license.key');

    if (!fs.existsSync(licensePath)) {
        result.error = 'license.key 파일이 없습니다';
        return result;
    }

    try {
        const raw = fs.readFileSync(licensePath, 'utf-8').trim();
        const parts = raw.split('.');
        if (parts.length !== 2) {
            result.error = '잘못된 라이선스 형식';
            return result;
        }

        const [payloadB64, sigB64] = parts;
        const payload = Buffer.from(payloadB64, 'base64').toString('utf-8');
        const expectedSig = crypto.createHmac('sha256', SIGN_KEY).update(payloadB64).digest('base64');

        if (sigB64 !== expectedSig) {
            result.error = '라이선스 서명이 유효하지 않습니다';
            return result;
        }

        const data = JSON.parse(payload);

        // Check expiry
        if (data.expiry) {
            const expiryDate = new Date(data.expiry + 'T23:59:59');
            if (Date.now() > expiryDate.getTime()) {
                result.error = `라이선스가 만료되었습니다 (${data.expiry})`;
                return result;
            }
        }

        result.valid = true;
        result.academy = data.academy || '';
        result.maxPCs = data.maxPCs || 10;
        result.edition = data.edition || 'standard';
        result.expiry = data.expiry || '';
        result.serial = data.serial || '';
        return result;

    } catch (err) {
        result.error = '라이선스 검증 오류: ' + err.message;
        return result;
    }
}

module.exports = { verifyLicense, SIGN_KEY };
