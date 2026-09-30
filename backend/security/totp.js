import crypto from 'node:crypto';
import QRCode from 'qrcode';

/**
 * Zero-Cost TOTP (Time-Based One-Time Password) Engine
 * Implements RFC 6238 and RFC 4226 without external paid SMS/Email gateways.
 * Free, interoperable with Google Authenticator, Microsoft Authenticator, Bitwarden, etc.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode buffer into RFC 4648 Base32 string (without padding)
 */
export function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;

        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
}

/**
 * Decode RFC 4648 Base32 string to Buffer
 */
export function base32Decode(base32) {
    const clean = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const output = [];

    for (let i = 0; i < clean.length; i++) {
        const val = BASE32_ALPHABET.indexOf(clean[i]);
        if (val === -1) continue;

        value = (value << 5) | val;
        bits += 5;

        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(output);
}

/**
 * Generate cryptographically secure Base32 secret for TOTP (160 bits = 20 bytes)
 */
export function generateTotpSecret(numBytes = 20) {
    const randomBytes = crypto.randomBytes(numBytes);
    return base32Encode(randomBytes);
}

/**
 * Compute 6-digit TOTP code for a given secret at timestamp
 */
export function computeTotp(secretBase32, timeStepSeconds = 30, epochMs = Date.now(), digits = 6) {
    const counter = Math.floor(epochMs / 1000 / timeStepSeconds);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(BigInt(counter));

    const key = base32Decode(secretBase32);
    const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();

    // Dynamic truncation (RFC 4226 section 5.4)
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    const otp = binary % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
}

/**
 * Verify TOTP with +/- 1 step clock-skew allowance (30s past, current, 30s future)
 */
export function verifyTotpCode(secretBase32, inputCode, timeStepSeconds = 30) {
    if (!secretBase32 || !inputCode) return false;
    const cleanCode = String(inputCode).trim();
    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) return false;

    const now = Date.now();
    const steps = [-1, 0, 1]; // +/- 30s window

    for (const step of steps) {
        const testEpoch = now + step * (timeStepSeconds * 1000);
        const expected = computeTotp(secretBase32, timeStepSeconds, testEpoch);
        // Constant-time comparison against timing attacks
        if (crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expected))) {
            return true;
        }
    }

    return false;
}

/**
 * Build standard otpauth URI
 */
export function buildOtpauthUri({ issuer = 'Ashvin Pharmacy', accountName, secret }) {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generate QR Code data URL for authenticator app scanning
 */
export async function generateQrCodeDataUrl(otpauthUri) {
    return await QRCode.toDataURL(otpauthUri, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 260,
        color: {
            dark: '#0f172a',
            light: '#ffffff'
        }
    });
}

export default {
    generateTotpSecret,
    computeTotp,
    verifyTotpCode,
    buildOtpauthUri,
    generateQrCodeDataUrl,
    base32Encode,
    base32Decode
};
