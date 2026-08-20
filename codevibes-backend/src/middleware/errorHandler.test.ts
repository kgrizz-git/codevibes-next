import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../utils/logger.js', () => ({
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { errorHandler, notFoundHandler } from './errorHandler.js';

function mockRes(): Response & { statusCode?: number; body?: unknown } {
    const res = {
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

describe('errorHandler', () => {
    it('defaults unknown errors to a 500 with no code', () => {
        const res = mockRes();
        const next = vi.fn() as NextFunction;
        errorHandler(new Error('boom'), {} as Request, res, next);

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: 'boom', code: undefined });
    });

    it('honours a custom statusCode and code on the error', () => {
        const err = new Error('bad input') as Error & { statusCode?: number; code?: string };
        err.statusCode = 422;
        err.code = 'VALIDATION';
        const res = mockRes();
        errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

        expect(res.statusCode).toBe(422);
        expect(res.body).toEqual({ error: 'bad input', code: 'VALIDATION' });
    });

    it('falls back to a generic message when the error has none', () => {
        const res = mockRes();
        errorHandler({} as Error, {} as Request, res, vi.fn() as NextFunction);

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: 'Internal Server Error', code: undefined });
    });
});

describe('notFoundHandler', () => {
    it('responds 404 with the method and path', () => {
        const res = mockRes();
        notFoundHandler({ method: 'GET', path: '/api/nope' } as Request, res);

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: 'Route not found: GET /api/nope' });
    });
});
