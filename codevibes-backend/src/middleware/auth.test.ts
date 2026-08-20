import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// database.js opens a SQLite file at import time, so it is mocked. These tests
// assert the auth middleware's decision points, not persistence.
vi.mock('../utils/database.js', () => ({
    findUserById: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { findUserById } from '../utils/database.js';
import { requireAuth, optionalAuth, generateToken } from '../utils/auth.js';

const findUserByIdMock = vi.mocked(findUserById);

function mockReq(overrides: Record<string, unknown> = {}): Request {
    const req: Record<string, unknown> = { cookies: {}, ...overrides };
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

const sampleUser = {
    id: 'u1',
    github_id: 1,
    username: 'dev',
    github_token: 'gho_token',
} as never;

describe('requireAuth', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects when no auth token cookie is present', () => {
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        requireAuth(mockReq(), res, next);

        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Authentication required' });
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a malformed cookie value before verification', () => {
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        requireAuth(mockReq({ cookies: { auth_token: 'garbage' } }), res, next);

        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Authentication required' });
        expect(res.cookie).not.toHaveBeenCalled();
    });

    it('rejects an invalid token and clears the cookie', () => {
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        // A three-segment but unsigned value passes the cookie shape check and
        // then fails JWT verification.
        requireAuth(mockReq({ cookies: { auth_token: 'a.b.c' } }), res, next);

        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid or expired token' });
        expect(res.cookie).toHaveBeenCalledWith('auth_token', '', expect.any(Object));
    });

    it('rejects a valid token whose user no longer exists', () => {
        findUserByIdMock.mockReturnValue(undefined);
        const token = generateToken({ userId: 'ghost', githubId: 9, username: 'gone' });
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        requireAuth(mockReq({ cookies: { auth_token: token } }), res, next);

        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'User not found' });
    });

    it('attaches the user and delegates to next on a valid token', () => {
        findUserByIdMock.mockReturnValue(sampleUser);
        const token = generateToken({ userId: 'u1', githubId: 1, username: 'dev' });
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        const req = mockReq({ cookies: { auth_token: token } });
        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect((req as unknown as { user: unknown }).user).toBe(sampleUser);
        expect(res.statusCode).toBeUndefined();
    });
});

describe('optionalAuth', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does not block requests without a token', () => {
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        const req = mockReq();
        optionalAuth(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect((req as { user?: unknown }).user).toBeUndefined();
    });

    it('populates req.user for a valid token', () => {
        findUserByIdMock.mockReturnValue(sampleUser);
        const token = generateToken({ userId: 'u1', githubId: 1, username: 'dev' });
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        const req = mockReq({ cookies: { auth_token: token } });
        optionalAuth(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect((req as unknown as { user: unknown }).user).toBe(sampleUser);
    });

    it('skips population for an invalid token without erroring', () => {
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        const req = mockReq({ cookies: { auth_token: 'garbage' } });
        optionalAuth(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect((req as { user?: unknown }).user).toBeUndefined();
    });
});
