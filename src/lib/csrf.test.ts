import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureCsrfToken, resetCsrfTokenCache, withCsrfHeaders } from './csrf';

afterEach(() => {
    resetCsrfTokenCache();
    vi.unstubAllGlobals();
    document.cookie.split(';').forEach((part) => {
        const name = part.split('=')[0]?.trim();
        if (name) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        }
    });
});

describe('ensureCsrfToken', () => {
    it('reads csrfToken from the health JSON body', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'ok', csrfToken: 'from-health' }),
            })
        );
        await expect(ensureCsrfToken('http://localhost:3001')).resolves.toBe('from-health');
    });

    it('throws instead of returning null when health has no token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'ok' }),
            })
        );
        await expect(ensureCsrfToken('http://localhost:3001')).rejects.toThrow(
            'Could not obtain a CSRF token'
        );
    });
});

describe('withCsrfHeaders', () => {
    it('sets X-CSRF-Token on POST after priming from health', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ csrfToken: 'abc123' }),
            })
        );
        const init = await withCsrfHeaders('http://localhost:3001', { method: 'POST' });
        const headers = new Headers(init.headers);
        expect(headers.get('X-CSRF-Token')).toBe('abc123');
        expect(init.credentials).toBe('include');
    });
});
