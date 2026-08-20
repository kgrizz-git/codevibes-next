import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    analyzeRepository,
    validateRepo,
    getEstimate,
    checkHealth,
    saveAnalysis,
    type SSEEventType,
} from './api';
import { resetCsrfTokenCache } from './csrf';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i < chunks.length) {
                controller.enqueue(encoder.encode(chunks[i]));
                i += 1;
            } else {
                controller.close();
            }
        },
    });
}

function jsonFrame(type: SSEEventType, data: unknown): string {
    return `data: ${JSON.stringify({ type, data })}\n\n`;
}

describe('SSE analysis stream contract', () => {
    let fetchOverride: ((url: string, init?: RequestInit) => Promise<any> | undefined) | undefined;

    beforeEach(() => {
        resetCsrfTokenCache();
        vi.stubGlobal('fetch', vi.fn());
        const fetchMock = (url: string, init?: RequestInit): Promise<any> => {
            if (String(url).includes('/api/health')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ status: 'ok', version: '1.0.4', csrfToken: 'test-csrf' }),
                });
            }
            return fetchOverride?.(url, init) ?? Promise.resolve({ ok: true, body: null, json: vi.fn() });
        };
        vi.mocked(fetch).mockImplementation(fetchMock as never);
    });
    afterEach(() => {
        fetchOverride = undefined;
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function respondWith(value: any): void {
        fetchOverride = () => Promise.resolve(value);
    }

    const baseResponse = (body: ReadableStream<Uint8Array>, ok = true) => ({
        ok,
        body,
        json: vi.fn(),
    });

    it('parses status, issue and complete events in order', async () => {
        const events: string[] = [];
        const received: unknown[] = [];
        const body = makeStream([
            jsonFrame('status', { message: 'scanning', filesScanned: 1, totalFiles: 3 }),
            jsonFrame('issue', { id: 'i1', title: 'x' }),
            jsonFrame('complete', { priority: 1, filesScanned: 3, issuesFound: 1, tokensUsed: 10, cost: 0 }),
        ]);

        respondWith(baseResponse(body));

        const done = new Promise<void>((resolve) => {
            analyzeRepository('https://github.com/o/r', 'sk', 1, {
                onStatus: (d) => { events.push('status'); received.push(d); },
                onIssue: (d) => { events.push('issue'); received.push(d); },
                onComplete: (d) => { events.push('complete'); received.push(d); resolve(); },
            });
        });
        await done;

        expect(events).toEqual(['status', 'issue', 'complete']);
        expect(received[2]).toMatchObject({ priority: 1, filesScanned: 3, issuesFound: 1, tokensUsed: 10 });
    });

    it('skips heartbeats and blank lines', async () => {
        let statusCalls = 0;
        const body = makeStream([
            'data: :heartbeat\n\n',
            '\n',
            jsonFrame('status', { message: 'ok', filesScanned: 0, totalFiles: 0 }),
            'data: :heartbeat\n\n',
        ]);

        respondWith(baseResponse(body));

        const done = new Promise<void>((resolve) => {
            analyzeRepository('https://github.com/o/r', 'sk', 1, {
                onStatus: () => { statusCalls += 1; resolve(); },
            });
        });
        await done;
        expect(statusCalls).toBe(1);
    });

    it('emits a REQUEST_FAILED error when the response is not ok', async () => {
        respondWith({
            ok: false,
            json: async () => ({ error: 'bad key' }),
        });

        const error = await new Promise<{ message: string; code: string }>((resolve) => {
            analyzeRepository('https://github.com/o/r', 'sk', 1, {
                onError: (e) => resolve(e),
            });
        });
        expect(error).toMatchObject({ message: 'bad key', code: 'REQUEST_FAILED', retryable: false });
    });

    it('emits a STREAM_ERROR when no body is returned', async () => {
        respondWith({ ok: true, body: null, json: vi.fn() });

        const error = await new Promise<{ code: string }>((resolve) => {
            analyzeRepository('https://github.com/o/r', 'sk', 1, { onError: (e) => resolve(e) });
        });
        expect(error.code).toBe('STREAM_ERROR');
    });

    it('emits a NETWORK_ERROR (retryable) on fetch rejection', async () => {
        respondWith(Promise.reject(Object.assign(new Error('offline'), { name: 'TypeError' })));

        const error = await new Promise<{ code: string; retryable: boolean }>((resolve) => {
            analyzeRepository('https://github.com/o/r', 'sk', 1, {
                onError: (e) => resolve(e),
            });
        });
        expect(error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    });

    it('does not call onError when an AbortError closes the stream', async () => {
        const body = makeStream([jsonFrame('status', { message: 'x', filesScanned: 0, totalFiles: 0 })]);
        respondWith(baseResponse(body));

        let errored = false;
        const handle = analyzeRepository('https://github.com/o/r', 'sk', 1, {
            onError: () => { errored = true; },
        });
        handle.abort();
        await new Promise((r) => setTimeout(r, 10));
        expect(errored).toBe(false);
    });
});

describe('validateRepo / getEstimate error paths', () => {
    let fetchOverride: ((url: string, init?: RequestInit) => Promise<any> | undefined) | undefined;

    beforeEach(() => {
        resetCsrfTokenCache();
        vi.stubGlobal('fetch', vi.fn());
        const fetchMock = (url: string): Promise<any> => {
            if (String(url).includes('/api/health')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ status: 'ok', version: '1.0.4', csrfToken: 'test-csrf' }),
                });
            }
            return fetchOverride?.(url) ?? Promise.resolve({ ok: true, json: vi.fn() });
        };
        vi.mocked(fetch).mockImplementation(fetchMock as never);
    });
    afterEach(() => {
        fetchOverride = undefined;
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });
    function respondWith(value: any): void {
        fetchOverride = () => Promise.resolve(value);
    }

    it('returns the JSON body from validateRepo on success', async () => {
        respondWith({ ok: true, json: async () => ({ valid: true, owner: 'o', name: 'r' }) });
        await expect(validateRepo('https://github.com/o/r')).resolves.toMatchObject({
            valid: true,
            owner: 'o',
        });
    });

    it('returns the response body from validateRepo when the server rejects it', async () => {
        respondWith({ ok: false, json: async () => ({ error: 'nope' }) });
        await expect(validateRepo('https://github.com/o/r')).resolves.toEqual({ error: 'nope' });
    });

    it('throws with the server error from getEstimate', async () => {
        respondWith({ ok: false, json: async () => ({ error: 'rate limited' }) });
        await expect(getEstimate('https://github.com/o/r')).rejects.toThrow('rate limited');
    });
});

describe('checkHealth remembers the csrf token', () => {
    beforeEach(() => {
        resetCsrfTokenCache();
        vi.stubGlobal('fetch', vi.fn());
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'ok', version: '1.0.4', csrfToken: 'tok' }),
        } as never);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('returns health info and caches the csrf token', async () => {
        const body = await checkHealth();
        expect(body).toMatchObject({ status: 'ok', csrfToken: 'tok' });
    });
});

describe('saveAnalysis', () => {
    beforeEach(() => {
        resetCsrfTokenCache();
        vi.stubGlobal('fetch', vi.fn());
        const fetchMock = (url: string): Promise<any> => {
            if (String(url).includes('/api/health')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ status: 'ok', version: '1.0.4', csrfToken: 'test-csrf' }),
                });
            }
            return Promise.resolve({ ok: true });
        };
        vi.mocked(fetch).mockImplementation(fetchMock as never);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    const payload = {
        repoUrl: 'x',
        repoName: 'r',
        issuesCount: 0,
        vibeScore: 100,
        tokensUsed: 0,
        cost: 0,
        filesScanned: 1,
        durationMs: 1000,
        issues: [],
    };

    it('resolves true on a 2xx response', async () => {
        await expect(saveAnalysis(payload)).resolves.toBe(true);
    });

    it('resolves false on a non-2xx response', async () => {
        vi.mocked(fetch).mockImplementation((url: string): any => {
            if (String(url).includes('/api/health')) {
                return Promise.resolve({ ok: true, json: async () => ({ csrfToken: 't' }) });
            }
            return Promise.resolve({ ok: false });
        });
        await expect(saveAnalysis(payload)).resolves.toBe(false);
    });
});
