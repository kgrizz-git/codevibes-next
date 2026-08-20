import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../utils/auth.js';

// analysisService reaches GitHub and the model provider, so it is mocked at the
// module boundary. These tests cover the controller's request contract only:
// body/query validation, SSE header framing, and error-to-status mapping.
vi.mock('../services/analysisService.js', () => ({
    analyzeRepository: vi.fn(),
    getEstimate: vi.fn(),
    validateRepository: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), request: vi.fn() },
}));

import * as analysisService from '../services/analysisService.js';
import { analyze, estimate, validateRepo, health } from './analysisController.js';

const analyzeRepositoryMock = vi.mocked(analysisService.analyzeRepository);
const getEstimateMock = vi.mocked(analysisService.getEstimate);
const validateRepositoryMock = vi.mocked(analysisService.validateRepository);

type MockRes = Response & {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
    written: string[];
    writableEnded: boolean;
};

function mockReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
    const req: Record<string, unknown> = {
        body: {},
        query: {},
        on: vi.fn(),
        get: () => undefined,
        ...overrides,
    };
    return req as unknown as AuthenticatedRequest;
}

function mockRes(): MockRes {
    const res = {
        headers: {} as Record<string, string>,
        written: [] as string[],
        writableEnded: false,
        locals: {} as Record<string, unknown>,
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        status: vi.fn(),
        json: vi.fn(),
    };
    res.setHeader.mockImplementation((name: string, value: string) => {
        res.headers[name] = value;
        return res;
    });
    res.write.mockImplementation((chunk: string) => {
        res.written.push(chunk);
        return true;
    });
    res.end.mockImplementation(() => {
        res.writableEnded = true;
        return res;
    });
    res.status.mockImplementation((code: number) => {
        (res as { statusCode?: number }).statusCode = code;
        return res;
    });
    res.json.mockImplementation((body: unknown) => {
        (res as { body?: unknown }).body = body;
        return res;
    });
    return res as unknown as MockRes;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('analyze request schema', () => {
    it('rejects a missing repoUrl with 400 and does not start analysis', async () => {
        const res = mockRes();
        await analyze(mockReq({ body: { apiKey: 'sk-test', priority: 1 } }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'repoUrl is required' });
        expect(analyzeRepositoryMock).not.toHaveBeenCalled();
    });

    it('rejects a non-string repoUrl', async () => {
        const res = mockRes();
        await analyze(mockReq({ body: { repoUrl: 42, apiKey: 'sk-test', priority: 1 } }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'repoUrl is required' });
    });

    it('rejects a missing apiKey before any SSE headers are written', async () => {
        const res = mockRes();
        await analyze(mockReq({ body: { repoUrl: 'https://github.com/o/r', priority: 1 } }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'apiKey is required' });
        expect(res.setHeader).not.toHaveBeenCalled();
        expect(res.flushHeaders).not.toHaveBeenCalled();
    });

    it.each([0, 4, 'abc', undefined, null])('rejects priority %p', async (priority) => {
        const res = mockRes();
        await analyze(
            mockReq({ body: { repoUrl: 'https://github.com/o/r', apiKey: 'sk-test', priority } }),
            res,
        );

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'priority must be 1, 2, or 3' });
        expect(analyzeRepositoryMock).not.toHaveBeenCalled();
    });

    it.each([1, 2, 3])('accepts priority %i and forwards it as a number', async (priority) => {
        analyzeRepositoryMock.mockResolvedValue(undefined);
        const res = mockRes();
        await analyze(
            mockReq({ body: { repoUrl: 'https://github.com/o/r', apiKey: 'sk-test', priority } }),
            res,
        );

        expect(analyzeRepositoryMock).toHaveBeenCalledWith(
            res,
            'https://github.com/o/r',
            'sk-test',
            priority,
            'standard',
            20,
            undefined,
        );
    });

    it('accepts a numeric string priority (form-encoded clients)', async () => {
        analyzeRepositoryMock.mockResolvedValue(undefined);
        const res = mockRes();
        await analyze(
            mockReq({ body: { repoUrl: 'https://github.com/o/r', apiKey: 'sk-test', priority: '2' } }),
            res,
        );

        expect(analyzeRepositoryMock).toHaveBeenCalledWith(
            res,
            'https://github.com/o/r',
            'sk-test',
            2,
            'standard',
            20,
            undefined,
        );
    });

    it.each([null, '', 'fast', ['quick'], { effort: 'quick' }, 1])('rejects invalid effort %p before opening SSE', async (effort) => {
        const res = mockRes();
        await analyze(
            mockReq({ body: { repoUrl: 'https://github.com/o/r', apiKey: 'sk-test', priority: 1, effort } }),
            res,
        );

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'effort must be quick, standard, or thorough' });
        expect(res.flushHeaders).not.toHaveBeenCalled();
        expect(analyzeRepositoryMock).not.toHaveBeenCalled();
    });

    it.each([
        ['quick', 5],
        ['standard', 20],
        ['thorough', 40],
    ] as const)('forwards %s effort and its resolved %i-file cap', async (effort, maxFilesPerPriority) => {
        analyzeRepositoryMock.mockResolvedValue(undefined);
        const res = mockRes();
        await analyze(
            mockReq({ body: { repoUrl: 'https://github.com/o/r', apiKey: 'sk-test', priority: 1, effort } }),
            res,
        );

        expect(analyzeRepositoryMock).toHaveBeenCalledWith(
            res,
            'https://github.com/o/r',
            'sk-test',
            1,
            effort,
            maxFilesPerPriority,
            undefined,
        );
    });
});

describe('analyze SSE framing', () => {
    const validBody = { repoUrl: 'https://github.com/o/r', apiKey: 'sk-test', priority: 1 };

    it('sets the SSE headers and flushes before streaming', async () => {
        analyzeRepositoryMock.mockResolvedValue(undefined);
        const res = mockRes();
        await analyze(mockReq({ body: validBody }), res);

        expect(res.headers['Content-Type']).toBe('text/event-stream');
        expect(res.headers['Cache-Control']).toBe('no-cache');
        expect(res.headers['Connection']).toBe('keep-alive');
        expect(res.headers['X-Accel-Buffering']).toBe('no');
        expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('passes the authenticated user github token through for private repos', async () => {
        analyzeRepositoryMock.mockResolvedValue(undefined);
        const res = mockRes();
        const req = mockReq({ body: validBody });
        (req as { user?: unknown }).user = { github_token: 'gho_secret' };

        await analyze(req, res);

        expect(analyzeRepositoryMock).toHaveBeenCalledWith(
            res,
            validBody.repoUrl,
            validBody.apiKey,
            1,
            'standard',
            20,
            'gho_secret',
        );
    });

    it('emits a well-formed error event and ends the stream when the service throws', async () => {
        analyzeRepositoryMock.mockRejectedValue(new Error('provider exploded'));
        const res = mockRes();
        await analyze(mockReq({ body: validBody }), res);

        expect(res.written).toHaveLength(1);
        const frame = res.written[0];
        expect(frame.startsWith('data: ')).toBe(true);
        expect(frame.endsWith('\n\n')).toBe(true);
        expect(JSON.parse(frame.slice(6, -2))).toEqual({
            type: 'error',
            data: { message: 'provider exploded', code: 'UNEXPECTED_ERROR', retryable: false },
        });
        expect(res.end).toHaveBeenCalled();
    });

    it('does not write an error event when the stream already ended', async () => {
        analyzeRepositoryMock.mockImplementation(async (streamRes) => {
            (streamRes as unknown as { writableEnded: boolean }).writableEnded = true;
            throw new Error('late failure');
        });
        const res = mockRes();
        await analyze(mockReq({ body: validBody }), res);

        expect(res.written).toHaveLength(0);
    });

    it('stops the heartbeat interval once the request settles', async () => {
        analyzeRepositoryMock.mockResolvedValue(undefined);
        const res = mockRes();
        await analyze(mockReq({ body: validBody }), res);

        res.written.length = 0;
        vi.advanceTimersByTime(60_000);
        expect(res.written).toHaveLength(0);
    });

    it('writes heartbeat comments while the analysis is in flight', async () => {
        let release!: () => void;
        analyzeRepositoryMock.mockImplementation(
            () => new Promise<void>((resolve) => { release = resolve; }),
        );
        const res = mockRes();
        const pending = analyze(mockReq({ body: validBody }), res);

        vi.advanceTimersByTime(15_000);
        expect(res.written).toEqual([':heartbeat\n\n']);

        release();
        await pending;
    });
});

describe('estimate error mapping', () => {
    it('requires the repoUrl query parameter', async () => {
        const res = mockRes();
        await estimate(mockReq({ query: {} }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'repoUrl query parameter is required' });
        expect(getEstimateMock).not.toHaveBeenCalled();
    });

    it.each([null, '', 'fast', ['quick'], { effort: 'quick' }, 1])('rejects invalid effort query value %p', async (effort) => {
        const res = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'https://github.com/o/r', effort } as never }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'effort must be quick, standard, or thorough' });
        expect(getEstimateMock).not.toHaveBeenCalled();
    });

    it('defaults omitted effort and forwards an explicitly selected effort exactly once', async () => {
        getEstimateMock.mockResolvedValue({ totalFiles: 3 } as never);
        const defaultRes = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'https://github.com/o/r' } }), defaultRes);
        expect(getEstimateMock).toHaveBeenLastCalledWith('https://github.com/o/r', 'standard', undefined);

        const selectedRes = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'https://github.com/o/r', effort: 'quick' } }), selectedRes);
        expect(getEstimateMock).toHaveBeenLastCalledWith('https://github.com/o/r', 'quick', undefined);
    });

    it('maps "not found" failures to 404', async () => {
        getEstimateMock.mockRejectedValue(new Error('Repository not found: o/r'));
        const res = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'https://github.com/o/r' } }), res);

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: 'Repository not found: o/r' });
    });

    it('maps "Invalid" failures to 400', async () => {
        getEstimateMock.mockRejectedValue(new Error('Invalid GitHub URL format'));
        const res = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'nope' } }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid GitHub URL format' });
    });

    it('hides unexpected failure details behind a 500', async () => {
        getEstimateMock.mockRejectedValue(new Error('ECONNRESET while talking to GitHub'));
        const res = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'https://github.com/o/r' } }), res);

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: 'Failed to estimate analysis' });
    });

    it('returns the estimate payload unchanged on success', async () => {
        const payload = { totalFiles: 3 } as never;
        getEstimateMock.mockResolvedValue(payload);
        const res = mockRes();
        await estimate(mockReq({ query: { repoUrl: 'https://github.com/o/r' } }), res);

        expect(res.body).toBe(payload);
        expect(res.statusCode).toBeUndefined();
    });
});

describe('validateRepo response contract', () => {
    it('rejects a missing repoUrl with valid:false', async () => {
        const res = mockRes();
        await validateRepo(mockReq({ body: {} }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'repoUrl is required', valid: false });
    });

    it('returns valid:true merged with repo metadata', async () => {
        validateRepositoryMock.mockResolvedValue({
            owner: 'o',
            name: 'r',
            fullName: 'o/r',
            isPrivate: false,
        } as never);
        const res = mockRes();
        await validateRepo(mockReq({ body: { repoUrl: 'https://github.com/o/r' } }), res);

        expect(res.body).toEqual({
            valid: true,
            owner: 'o',
            name: 'r',
            fullName: 'o/r',
            isPrivate: false,
        });
    });

    it('maps "not found" to 404 with valid:false', async () => {
        validateRepositoryMock.mockRejectedValue(new Error('Repository not found: o/r'));
        const res = mockRes();
        await validateRepo(mockReq({ body: { repoUrl: 'https://github.com/o/r' } }), res);

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ valid: false, error: 'Repository not found: o/r' });
    });

    it('maps other failures to 400 with valid:false', async () => {
        validateRepositoryMock.mockRejectedValue(new Error('Invalid GitHub URL format'));
        const res = mockRes();
        await validateRepo(mockReq({ body: { repoUrl: 'nope' } }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ valid: false, error: 'Invalid GitHub URL format' });
    });
});

describe('health csrf token exposure', () => {
    it('returns the csrf token to an allowed origin', () => {
        const res = mockRes();
        res.locals.csrfToken = 'tok-allowed';
        health(
            mockReq({ get: ((name: string) => (name === 'origin' ? 'http://localhost:8080' : undefined)) as never }),
            res,
        );

        expect(res.body).toMatchObject({ status: 'ok', csrfToken: 'tok-allowed' });
    });

    it('returns the csrf token when there is no Origin header (curl)', () => {
        const res = mockRes();
        res.locals.csrfToken = 'tok-curl';
        health(mockReq(), res);

        expect(res.body).toMatchObject({ csrfToken: 'tok-curl' });
    });

    it('withholds the csrf token from an unlisted origin', () => {
        const res = mockRes();
        res.locals.csrfToken = 'tok-secret';
        health(
            mockReq({ get: ((name: string) => (name === 'origin' ? 'https://evil.example' : undefined)) as never }),
            res,
        );

        expect((res.body as { csrfToken: string | null }).csrfToken).toBeNull();
    });

    it('returns null when no token was minted', () => {
        const res = mockRes();
        health(mockReq(), res);

        expect((res.body as { csrfToken: string | null }).csrfToken).toBeNull();
    });
});
