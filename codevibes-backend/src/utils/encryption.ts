// ============================================================
// Encryption Utility - AES-256-GCM for secure token storage
// ============================================================

import crypto from 'crypto';

// Encryption key from environment - MUST be set for production
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

function resolveKeyBuffer(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (key && KEY_HEX_RE.test(key)) return Buffer.from(key, 'hex');
    if (process.env.NODE_ENV === 'production') {
        throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes) and is required in production');
    }
    if (key) {
        console.warn('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes) - using an ephemeral random dev key instead');
    } else {
        console.warn('ENCRYPTION_KEY not set - using an ephemeral random dev key. Tokens encrypted under it are unrecoverable after restart; DO NOT USE IN PRODUCTION.');
    }
    return crypto.randomBytes(32);
}

const KEY_BUFFER = resolveKeyBuffer();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const HEX_RE = /^[0-9a-fA-F]+$/;

function isValidHexOfLength(text: string, byteLength: number): boolean {
    return HEX_RE.test(text) && text.length === byteLength * 2;
}

/**
 * Check if a string is in encrypted format (iv:authTag:ciphertext, all hex).
 * Strict: each part must be valid hex and decode to the exact expected length.
 * `Buffer.from` silently skips invalid hex pairs, so hex validity is checked
 * explicitly rather than relying on decoded buffer length alone.
 */
export function looksEncrypted(text: string): boolean {
    if (!text) return false;
    const parts = text.split(':');
    if (parts.length !== 3) return false;
    const [ivHex, authTagHex, ciphertext] = parts;
    return isValidHexOfLength(ivHex, IV_LENGTH) &&
        isValidHexOfLength(authTagHex, AUTH_TAG_LENGTH) &&
        HEX_RE.test(ciphertext) && ciphertext.length > 0;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * @returns Encrypted string in format: iv:authTag:ciphertext (all hex)
 */
export function encrypt(plaintext: string): string {
    if (!plaintext) return '';

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY_BUFFER, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Legacy plaintext formats that predate envelope encryption. Only values
 * matching these patterns are echoed back unchanged; every other non-empty
 * value that is not a valid envelope is treated as tampered or corrupt.
 */
const LEGACY_PATTERNS = [
    /^https?:\/\//i, // URLs
    /^ghp_/, // GitHub classic PATs
    /^gho_/, // GitHub OAuth access tokens
    /^ghu_/, // GitHub user-to-server tokens
    /^ghs_/, // GitHub server-to-server tokens
    /^ghr_/, // GitHub refresh tokens
    /^github_pat_/, // GitHub fine-grained PATs
    /^sk-/, // DeepSeek API keys
];

function isLegacyPlaintext(text: string): boolean {
    return LEGACY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Decrypt an encrypted string using AES-256-GCM
 * @param encryptedText Format: iv:authTag:ciphertext
 * @returns Decrypted plaintext
 * @throws If the input is not a valid envelope and not a known legacy
 *         plaintext format (e.g. a damaged envelope with a removed or added
 *         delimiter, or invalid-hex parts). Known legacy token formats and
 *         empty strings are returned unchanged.
 */
export function decrypt(encryptedText: string): string {
    // Legacy/unencrypted data passes through unchanged; empty strings too.
    if (!encryptedText) return encryptedText;

    if (looksEncrypted(encryptedText)) {
        const [ivHex, authTagHex, ciphertext] = encryptedText.split(':');

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        // Defense in depth: re-assert lengths at this boundary, don't trust the
        // classifier alone (decrypt is the security boundary).
        if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
            throw new Error('Failed to decrypt: data may be tampered or corrupt');
        }

        try {
            const decipher = crypto.createDecipheriv(ALGORITHM, KEY_BUFFER, iv, { authTagLength: AUTH_TAG_LENGTH });
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (err) {
            // Log the error type/message for forensics, never the ciphertext.
            const errorType = err instanceof Error ? err.message : String(err);
            console.warn(`Failed to decrypt (data may be tampered or corrupt): ${errorType}`);
            throw new Error('Failed to decrypt: data may be tampered or corrupt', { cause: err });
        }
    }

    // Not a valid envelope. Only known legacy plaintext formats pass through;
    // anything else (e.g. damaged ciphertext with a removed/added delimiter)
    // is treated as tampered or corrupt, never echoed back as a token.
    if (isLegacyPlaintext(encryptedText)) return encryptedText;
    throw new Error('Failed to decrypt: data may be tampered or corrupt');
}

/**
 * Check if a string is encrypted (has our format).
 * Delegates to the same strict check as decrypt()'s classifier.
 */
export function isEncrypted(text: string): boolean {
    return looksEncrypted(text);
}