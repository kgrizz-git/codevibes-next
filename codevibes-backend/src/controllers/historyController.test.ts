import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../utils/auth.js';

vi.mock('uuid', () => ({ v4: vi.fn(() => 'analysis-id') }));
vi.mock('../utils/database.js', () => ({
    createAnalysis: vi.fn(),
    getUserAnalyses: vi.fn(),
    getAnalysisById: vi.fn(),
    deleteAnalysis: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import * as database from '../utils/database.js';
import { getHistory, saveAnalysis } from './historyController.js';

const createAnalysisMock = vi.mocked(database.createAnalysis);
const getUserAnalysesMock = vi.mocked(database.getUserAnalyses);

function mockReq(body: Record<string, unknown> = {}): AuthenticatedRequest {
    return { body, query: {}, user: { id: 'user-id' } } as unknown as AuthenticatedRequest;
}

function mockRes(): Response & { statusCode?: number; body?: unknown } {
    const res = {
        statusCode: undefined as number | undefined,
        body: undefined as unknown,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: unknown) {
            this.body = body;
            return this;
        },
    };
    return res as unknown as Response & { statusCode?: number; body?: unknown };
}

beforeEach(() => vi.clearAllMocks());

describe('analysis history effort persistence', () => {
    const requiredBody = {
        repoUrl: 'https://github.com/owner/repo',
        repoName: 'repo',
        issues: [],
    };

    it('defaults an upgrading caller to standard and stores the selected effort', () => {
        createAnalysisMock.mockImplementation((analysis) => analysis as never);
        const res = mockRes();

        saveAnalysis(mockReq({ ...requiredBody, effort: 'thorough' }), res);

        expect(createAnalysisMock).toHaveBeenCalledWith(expect.objectContaining({ effort: 'thorough' }));
        expect(res.statusCode).toBe(201);

        saveAnalysis(mockReq(requiredBody), mockRes());
        expect(createAnalysisMock).toHaveBeenLastCalledWith(expect.objectContaining({ effort: 'standard' }));
    });

    it.each([null, '', 'fast', ['quick'], 1])('rejects invalid effort %p', (effort) => {
        const res = mockRes();
        saveAnalysis(mockReq({ ...requiredBody, effort }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'effort must be quick, standard, or thorough' });
        expect(createAnalysisMock).not.toHaveBeenCalled();
    });

    it('preserves a null effort on legacy rows for deliberate legacy rendering', () => {
        getUserAnalysesMock.mockReturnValue([{
            id: 'legacy', user_id: 'user-id', repo_url: 'url', repo_name: 'repo',
            issues_count: 0, vibe_score: 100, tokens_used: 0, cost: 0,
            effort: null, created_at: '2026-01-01',
        }]);
        const res = mockRes();

        getHistory(mockReq(), res);

        expect(res.body).toEqual({ analyses: [expect.objectContaining({ id: 'legacy', effort: null, issues: [] })] });
    });
});
