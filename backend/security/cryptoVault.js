import crypto from 'node:crypto';

/**
 * Enterprise Application-Level Field Encryption (AES-256-GCM)
 * Encrypts sensitive PII (Physical addresses, contact numbers, health notes) at rest
 * before storing into MongoDB or intermediate datastores.
 * 
 * Ciphertext Format: aes-256-gcm:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits authentication tag

// Derive 256-bit encryption key using scrypt from secret
const MASTER_SECRET = process.env.ENCRYPTION_SECRET_KEY
    || process.env.DEMO_ADMIN_JWT_SECRET
    || 'ashvin-pharmacy-zero-cost-pii-encryption-key-32chars!';

const SALT = Buffer.from('ashvin-pharmacy-salt-2026', 'utf-8');
const DERIVED_KEY = crypto.scryptSync(MASTER_SECRET, SALT, 32);

/**
 * Encrypt arbitrary string or JSON-serializable object
 * @param {string|object} plaintext 
 * @returns {string} Formatted ciphertext with authenticated tag
 */
export function encryptPII(plaintext) {
    if (plaintext === null || plaintext === undefined) return null;
    const textToEncrypt = typeof plaintext === 'object' ? JSON.stringify(plaintext) : String(plaintext);

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, DERIVED_KEY, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });

    let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `aes-256-gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt authenticated ciphertext
 * @param {string} ciphertext 
 * @returns {string|object|null} Decrypted string or parsed object
 */
export function decryptPII(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
    if (!ciphertext.startsWith('aes-256-gcm:')) {
        // Unencrypted legacy fallback
        return ciphertext;
    }

    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 4) return ciphertext;

        const [, ivHex, tagHex, encryptedHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(tagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, DERIVED_KEY, iv, {
            authTagLength: AUTH_TAG_LENGTH
        });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        try {
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    } catch (err) {
        console.error('⚠️ [CryptoVault] GCM authentication failed! Data has been tampered with or key changed:', err.message);
        return '[TAMPERED_OR_CORRUPT_PII]';
    }
}

export default { encryptPII, decryptPII };
