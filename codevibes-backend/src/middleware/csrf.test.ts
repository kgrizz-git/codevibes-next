import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { csrfProtection } from './csrf.js';

function mockReq(opts: {
    method: string;
    cookies?: Record<string, string> | undefined;
    headers?: Record<string, string>;
    omitCookies?: boolean;
}): Request {
    const headers = Object.fromEntries(
        Object.entries(opts.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    const req: Record<string, unknown> = {
        method: opts.method,
        get: (name: string) => headers[name.toLowerCase()],
    };
    if (!opts.omitCookies) {
        req.cookies = opts.cookies || {};
    }
    return req as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: unknown } {
    const res = {
        cookie: vi.fn(),
        status: vi.fn(),
        json: vi.fn(),
        locals: {} as Record<string, unknown>,
    };
    res.status.mockImplementation((code: number) => {
        (res as { statusCode?: number }).statusCode = code;
        return res;
    });
    res.json.mockImplementation((body: unknown) => {
        (res as { body?: unknown }).body = body;
        return res;
    });
    return res as unknown as Response & { statusCode?: number; body?: unknown };
}

describe('csrfProtection', () => {
    it('sets a csrf_token cookie on GET when missing and exposes it on locals', () => {
        const req = mockReq({ method: 'GET', cookies: {} });
        const res = mockRes();
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.cookie).toHaveBeenCalledWith(
            'csrf_token',
            expect.stringMatching(/^[0-9a-f]{64}$/),
            expect.objectContaining({ httpOnly: false, sameSite: 'lax', path: '/' })
        );
        expect(res.locals.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects browser POST when the CSRF header does not match the cookie', () => {
        const req = mockReq({
            method: 'POST',
            cookies: { csrf_token: 'abc' },
            headers: { origin: 'http://localhost:8080', 'x-csrf-token': 'wrong' },
        });
        const res = mockRes();
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows browser POST when the CSRF header matches the existing cookie', () => {
        const req = mockReq({
            method: 'POST',
            cookies: { csrf_token: 'abc' },
            headers: { origin: 'http://localhost:8080', 'x-csrf-token': 'abc' },
        });
        const res = mockRes();
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('allows POST without Origin (curl / non-browser clients)', () => {
        const req = mockReq({ method: 'POST', cookies: { csrf_token: 'abc' } });
        const res = mockRes();
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('rejects cookieless browser POST without minting a same-request token', () => {
        const req = mockReq({
            method: 'POST',
            cookies: {},
            headers: { origin: 'http://localhost:8080', 'x-csrf-token': 'guess' },
        });
        const res = mockRes();
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.cookie).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('does not throw when cookies is undefined on a browser POST', () => {
        const req = mockReq({
            method: 'POST',
            omitCookies: true,
            headers: { origin: 'http://localhost:8080', 'x-csrf-token': 'abc' },
        });
        const res = mockRes();
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
