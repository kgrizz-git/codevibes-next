import { describe, it, expect } from 'vitest';
import { encrypt, looksEncrypted } from './encryption.js';
import { generateToken, readAuthTokenFromCookieValue } from './auth.js';

describe('auth cookie encryption', () => {
    it('encrypts JWTs so the cookie value is not plaintext', () => {
        const jwt = generateToken({ userId: 'u1', githubId: 1, username: 'dev' });
        const stored = encrypt(jwt);
        expect(looksEncrypted(stored)).toBe(true);
        expect(stored).not.toContain(jwt);
        expect(readAuthTokenFromCookieValue(stored)).toBe(jwt);
    });

    it('still accepts legacy plaintext JWTs', () => {
        const jwt = generateToken({ userId: 'u2', githubId: 2, username: 'legacy' });
        expect(readAuthTokenFromCookieValue(jwt)).toBe(jwt);
    });

    it('returns null for garbage cookie values', () => {
        expect(readAuthTokenFromCookieValue('')).toBeNull();
        expect(readAuthTokenFromCookieValue('not-a-token')).toBeNull();
    });
});
