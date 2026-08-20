import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('isAllowedOrigin (default allowlist)', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('allows requests with no Origin (curl)', async () => {
        const { isAllowedOrigin } = await import('./origins.js');
        expect(isAllowedOrigin(undefined)).toBe(true);
    });

    it('allows the Vite SPA origin from the default list', async () => {
        const { isAllowedOrigin } = await import('./origins.js');
        expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
    });

    it('rejects an unlisted sibling origin', async () => {
        const { isAllowedOrigin } = await import('./origins.js');
        expect(isAllowedOrigin('http://localhost:9999')).toBe(false);
    });
});

describe('isAllowedOrigin (env overrides)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('does not treat ALLOWED_ORIGINS=* as a wildcard', async () => {
        vi.stubEnv('ALLOWED_ORIGINS', '*');
        vi.resetModules();
        const mod = await import('./origins.js');
        expect(mod.ALLOWED_ORIGINS).toEqual(['*']);
        expect(mod.isAllowedOrigin('http://evil.example')).toBe(false);
    });

    it('drops empty entries from ALLOWED_ORIGINS', async () => {
        vi.stubEnv('ALLOWED_ORIGINS', 'http://localhost:8080,, ,http://localhost:5173');
        vi.resetModules();
        const mod = await import('./origins.js');
        expect(mod.ALLOWED_ORIGINS).toEqual(['http://localhost:8080', 'http://localhost:5173']);
        expect(mod.isAllowedOrigin('http://localhost:8080')).toBe(true);
        expect(mod.isAllowedOrigin('http://localhost:9999')).toBe(false);
    });
});
