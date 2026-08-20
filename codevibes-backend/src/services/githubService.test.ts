import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Octokit performs network calls; mock it so we can drive GitHub error paths
// and assert the error-message contracts the controller maps on.
vi.mock('@octokit/rest', () => {
    const instance = {
        repos: {
            get: vi.fn(),
            getContent: vi.fn(),
        },
        git: {
            getTree: vi.fn(),
        },
    };
    return {
        Octokit: class {
            constructor() {
                return instance;
            }
        },
        __instance: instance,
    };
});

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { parseGitHubUrl, validateRepo, getFileTree, clearFileTreeCache } from './githubService.js';

const octokit = (await import('@octokit/rest') as unknown as { __instance: any }).__instance;

beforeEach(() => {
    vi.clearAllMocks();
    clearFileTreeCache();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('parseGitHubUrl', () => {
    it('extracts owner and repo from a normal URL', () => {
        expect(parseGitHubUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('strips a .git suffix', () => {
        expect(parseGitHubUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('strips trailing path, query and fragment', () => {
        expect(parseGitHubUrl('https://github.com/owner/repo/tree/main?foo=1#bar')).toEqual({
            owner: 'owner',
            repo: 'repo',
        });
    });

    it('returns null for non-GitHub URLs', () => {
        expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
        expect(parseGitHubUrl('not a url')).toBeNull();
    });
});

describe('validateRepo error contracts', () => {
    it('throws a "not found" message on a 404', async () => {
        octokit.repos.get.mockRejectedValue({ status: 404 });
        await expect(validateRepo('owner', 'missing')).rejects.toThrow('Repository not found: owner/missing');
    });

    it('throws a rate-limit message on a 403', async () => {
        octokit.repos.get.mockRejectedValue({ status: 403 });
        await expect(validateRepo('owner', 'repo')).rejects.toThrow(/rate limit/i);
    });

    it('wraps other GitHub errors generically', async () => {
        octokit.repos.get.mockRejectedValue({ status: 500, message: 'boom' });
        await expect(validateRepo('owner', 'repo')).rejects.toThrow('Failed to fetch repository: boom');
    });

    it('returns repo metadata on success', async () => {
        octokit.repos.get.mockResolvedValue({
            data: {
                full_name: 'owner/repo',
                description: 'A repo',
                stargazers_count: 12,
                language: 'TypeScript',
                updated_at: '2024-01-01',
                default_branch: 'main',
                private: false,
            },
        });
        const info = await validateRepo('owner', 'repo');
        expect(info).toMatchObject({ owner: 'owner', name: 'repo', isPrivate: false, defaultBranch: 'main' });
    });
});

describe('getFileTree error contracts', () => {
    it('throws a branch/404 message when the tree is missing', async () => {
        octokit.git.getTree.mockRejectedValue({ status: 404 });
        await expect(getFileTree('owner', 'repo')).rejects.toThrow(
            'Repository or branch not found: owner/repo',
        );
    });

    it('throws an empty-repo message on a 409 conflict', async () => {
        octokit.git.getTree.mockRejectedValue({ status: 409 });
        await expect(getFileTree('owner', 'repo')).rejects.toThrow('Repository is empty');
    });

    it('wraps other tree errors generically', async () => {
        octokit.git.getTree.mockRejectedValue({ status: 500, message: 'nope' });
        await expect(getFileTree('owner', 'repo')).rejects.toThrow('Failed to get file tree: nope');
    });
});
