import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('./githubService.js', () => ({
    parseGitHubUrl: vi.fn(),
    validateRepo: vi.fn(),
    getFilesForPriority: vi.fn(),
    getCategorizedFileCounts: vi.fn(),
}));

vi.mock('./deepseekService.js', () => ({ streamAnalysis: vi.fn() }));
vi.mock('../utils/tokenCounter.js', () => ({ calculateCost: vi.fn((input: number, output: number) => input + output) }));
vi.mock('../utils/fileFilter.js', () => ({ getPriorityName: vi.fn(() => 'Priority 1') }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import * as githubService from './githubService.js';
import * as deepseekService from './deepseekService.js';
import { analyzeRepository, getEstimate } from './analysisService.js';

const parseGitHubUrlMock = vi.mocked(githubService.parseGitHubUrl);
const validateRepoMock = vi.mocked(githubService.validateRepo);
const getFilesForPriorityMock = vi.mocked(githubService.getFilesForPriority);
const getCategorizedFileCountsMock = vi.mocked(githubService.getCategorizedFileCounts);
const streamAnalysisMock = vi.mocked(deepseekService.streamAnalysis);

function mockResponse(): Response & { frames: string[]; writableEnded: boolean } {
    const res = {
        frames: [] as string[],
        writableEnded: false,
        write(chunk: string) {
            this.frames.push(chunk);
            return true;
        },
        end() {
            this.writableEnded = true;
            return this;
        },
    };
    return res as unknown as Response & { frames: string[]; writableEnded: boolean };
}

function completeEvents(res: ReturnType<typeof mockResponse>): Array<Record<string, unknown>> {
    return res.frames
        .filter(frame => frame.startsWith('data: '))
        .map(frame => JSON.parse(frame.slice(6)) as { type: string; data: Record<string, unknown> })
        .filter(event => event.type === 'complete')
        .map(event => event.data);
}

beforeEach(() => {
    vi.clearAllMocks();
    parseGitHubUrlMock.mockReturnValue({ owner: 'owner', repo: 'repo' });
    validateRepoMock.mockResolvedValue({ isPrivate: false } as never);
});

describe('getEstimate', () => {
    it('uses the effort cap consistently for every priority bucket and exposes it', async () => {
        getCategorizedFileCountsMock.mockResolvedValue({
            priority1: 9,
            priority2: 6,
            priority3: 50,
            ignored: 0,
            total: 65,
        });

        const estimate = await getEstimate('https://github.com/owner/repo', 'quick');

        expect(estimate.effort).toBe('quick');
        expect(estimate.maxFilesPerPriority).toBe(5);
        expect(estimate.priority1.files).toBe(5);
        expect(estimate.priority2.files).toBe(5);
        expect(estimate.priority3.files).toBe(5);
        expect(estimate.totalFiles).toBe(15);
    });
});

describe('analyzeRepository', () => {
    it('uses the resolved cap for live and next-priority fetches and returns effort on completion', async () => {
        getFilesForPriorityMock
            .mockResolvedValueOnce({ files: [{ path: 'src/a.ts', content: 'code', size: 4 }], totalMatching: 1 })
            .mockResolvedValueOnce({ files: [{ path: 'src/b.ts', content: 'next', size: 4 }], totalMatching: 7 });
        streamAnalysisMock.mockReturnValue((async function* () {
            yield { type: 'complete', inputTokens: 10, outputTokens: 2, issues: [] };
        })() as never);
        const res = mockResponse();

        await analyzeRepository(res, 'https://github.com/owner/repo', 'sk-test', 1, 'quick', 5);

        expect(getFilesForPriorityMock).toHaveBeenNthCalledWith(
            1,
            'owner', 'repo', 1, 5, expect.any(Function), undefined,
        );
        expect(getFilesForPriorityMock).toHaveBeenNthCalledWith(
            2,
            'owner', 'repo', 2, 5, undefined, undefined,
        );
        expect(completeEvents(res)).toEqual([
            expect.objectContaining({
                priority: 1,
                effort: 'quick',
                filesScanned: 1,
                nextPriorityEstimate: {
                    files: 1,
                    estimatedTokens: 10,
                    estimatedCost: 12,
                },
            }),
        ]);
    });

    it('includes effort in a zero-file completion event', async () => {
        getFilesForPriorityMock.mockResolvedValue({ files: [], totalMatching: 0 });
        const res = mockResponse();

        await analyzeRepository(res, 'https://github.com/owner/repo', 'sk-test', 2, 'thorough', 40);

        expect(completeEvents(res)).toEqual([
            expect.objectContaining({ priority: 2, effort: 'thorough', filesScanned: 0, tokensUsed: 0, cost: 0 }),
        ]);
        expect(res.writableEnded).toBe(true);
    });
});
