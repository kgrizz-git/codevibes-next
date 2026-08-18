// ============================================================
// Encryption Utility - AES-256-GCM for secure token storage
// ============================================================

import crypto from 'crypto';

// Encryption key from environment - MUST be set for production
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 64) {
    console.warn('⚠️  ENCRYPTION_KEY not set or too short. Using fallback (NOT SECURE for production!)');
}
const KEY_BUFFER = Buffer.from((ENCRYPTION_KEY || '0'.repeat(64)).slice(0, 64), 'hex');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a plaintext string using AES-256-GCM
 * @returns Encrypted string in format: iv:authTag:ciphertext (all hex)
 */
export function encrypt(plaintext: string): string {
    if (!plaintext) return '';

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY_BUFFER, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string using AES-256-GCM
 * @param encryptedText Format: iv:authTag:ciphertext
 * @returns Decrypted plaintext
 */
export function decrypt(encryptedText: string): string {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;

    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            // Not encrypted format, return as-is (legacy data)
            return encryptedText;
        }

        const [ivHex, authTagHex, ciphertext] = parts;

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, KEY_BUFFER, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch {
        // If decryption fails, assume it's legacy unencrypted data
        return encryptedText;
    }
}

/**
 * Check if a string is encrypted (has our format)
 */
export function isEncrypted(text: string): boolean {
    if (!text) return false;
    const parts = text.split(':');
    return parts.length === 3 &&
        parts[0].length === IV_LENGTH * 2 &&
        parts[1].length === AUTH_TAG_LENGTH * 2;
}
