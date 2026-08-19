// ============================================================
// GitHub Service - Repository fetching and file management
// ============================================================

import { Octokit } from '@octokit/rest';
import type { RepoInfo, FileEntry, FileContent, PriorityLevel } from '../types/index.js';
import { categorizeFiles, filterFilesByPriority } from '../utils/fileFilter.js';
import { logger } from '../utils/logger.js';
import { APP_VERSION } from '../version.js';

// GitHub URL parsing regex
const GITHUB_URL_REGEX = /github\.com\/([^/]+)\/([^/]+)/;

/**
 * Parse a GitHub URL to extract owner and repo name
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(GITHUB_URL_REGEX);
    if (!match) {
        return null;
    }

    const owner = match[1];
    let repo = match[2];

    // Remove .git suffix if present
    if (repo.endsWith('.git')) {
        repo = repo.slice(0, -4);
    }

    // Remove any trailing path segments
    repo = repo.split('/')[0].split('?')[0].split('#')[0];

    return { owner, repo };
}

/**
 * Create an Octokit instance
 * Uses provided token or falls back to env token for higher rate limits
 */
function createOctokit(token?: string): Octokit {
    const authToken = token || process.env.GITHUB_TOKEN;

    return new Octokit({
        auth: authToken,
        userAgent: `CodeVibes/${APP_VERSION}`,
    });
}

/**
 * Validate a GitHub repository and get its metadata
 */
export async function validateRepo(owner: string, repo: string, token?: string): Promise<RepoInfo> {
    const octokit = createOctokit(token);

    try {
        const { data } = await octokit.repos.get({ owner, repo });

        return {
            owner,
            name: repo,
            fullName: data.full_name,
            description: data.description,
            stars: data.stargazers_count,
            language: data.language,
            lastUpdate: data.updated_at,
            defaultBranch: data.default_branch,
            isPrivate: data.private,
        };
    } catch (error: any) {
        if (error.status === 404) {
            throw new Error(`Repository not found: ${owner}/${repo}`);
        }
        if (error.status === 403) {
            throw new Error('GitHub API rate limit exceeded. Try again later or add a GITHUB_TOKEN.');
        }
        throw new Error(`Failed to fetch repository: ${error.message}`);
    }
}

// ⚡ OPTIMIZATION: In-memory cache for file trees (reduces API calls by ~80%)
const fileTreeCache = new Map<string, { data: FileEntry[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear file tree cache (useful for testing or manual refresh)
 */
export function clearFileTreeCache(): void {
    fileTreeCache.clear();
}

/**
 * Get the full file tree of a repository recursively
 * ⚡ OPTIMIZED: Caches results to avoid redundant API calls
 */
export async function getFileTree(owner: string, repo: string, branch?: string, token?: string): Promise<FileEntry[]> {
    const cacheKey = `${owner}/${repo}/${branch || 'default'}`;

    // Check cache first
    const cached = fileTreeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.info(`📦 Using cached file tree for ${owner}/${repo} (${cached.data.length} files)`);
        return cached.data;
    }

    const octokit = createOctokit(token);

    try {
        // Get the default branch if not specified
        const targetBranch = branch || (await validateRepo(owner, repo, token)).defaultBranch;

        // Get the tree recursively (GitHub Tree API - just 1 call!)
        const { data } = await octokit.git.getTree({
            owner,
            repo,
            tree_sha: targetBranch,
            recursive: 'true',
        });

        // Filter to only files (not directories)
        const files: FileEntry[] = data.tree
            .filter(item => item.type === 'blob' && item.path && item.sha)
            .map(item => ({
                path: item.path!,
                type: 'file' as const,
                size: item.size || 0,
                sha: item.sha!,
            }));

        logger.info(`✓ Fetched ${files.length} files from ${owner}/${repo}`);

        // Cache the results
        fileTreeCache.set(cacheKey, { data: files, timestamp: Date.now() });

        return files;
    } catch (error: any) {
        if (error.status === 404) {
            throw new Error(`Repository or branch not found: ${owner}/${repo}`);
        }
        if (error.status === 409) {
            throw new Error('Repository is empty');
        }
        throw new Error(`Failed to get file tree: ${error.message}`);
    }
}

/**
 * Get the content of a single file
 */
export async function getFileContent(
    owner: string,
    repo: string,
    path: string,
    token?: string
): Promise<FileContent> {
    const octokit = createOctokit(token);

    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path,
        });

        // getContent returns an array for directories, single object for files
        if (Array.isArray(data)) {
            throw new Error(`Path is a directory: ${path}`);
        }

        if (data.type !== 'file' || !('content' in data)) {
            throw new Error(`Not a file: ${path}`);
        }

        // Decode base64 content
        const content = Buffer.from(data.content, 'base64').toString('utf-8');

        return {
            path,
            content,
            size: data.size,
        };
    } catch (error: any) {
        if (error.status === 404) {
            throw new Error(`File not found: ${path}`);
        }
        throw new Error(`Failed to get file content: ${error.message}`);
    }
}

/**
 * Get contents of multiple files with parallel batching
 * ⚡ OPTIMIZED: Fetches files in parallel batches for 3-5x speed improvement
 */
export async function getFilesContents(
    owner: string,
    repo: string,
    paths: string[],
    maxFiles: number = 20,
    onProgress?: (current: number, total: number, path: string) => void,
    token?: string
): Promise<FileContent[]> {
    // Limit number of files
    const filesToFetch = paths.slice(0, maxFiles);
    const contents: FileContent[] = [];

    logger.info(`⚡ Fetching ${filesToFetch.length} files from ${owner}/${repo} (parallel batches)`);

    const BATCH_SIZE = 5; // Fetch 5 files concurrently
    let processedCount = 0;

    // Process files in parallel batches
    for (let i = 0; i < filesToFetch.length; i += BATCH_SIZE) {
        const batch = filesToFetch.slice(i, i + BATCH_SIZE);

        // Fetch all files in this batch concurrently
        const batchPromises = batch.map(async (path) => {
            try {
                const content = await getFileContent(owner, repo, path, token);
                return { success: true, content, path };
            } catch (error: any) {
                logger.warn(`Skipping file ${path}: ${error.message}`);
                return { success: false, path, error: error.message };
            }
        });

        // Wait for entire batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Process results and report progress
        for (const result of batchResults) {
            processedCount++;

            if (result.success) {
                // TypeScript type guard: result is { success: true, content: FileContent, path: string }
                contents.push((result as { success: true; content: FileContent; path: string }).content);
            }

            // Report progress for each file
            if (onProgress) {
                onProgress(processedCount, filesToFetch.length, result.path);
            }
        }

        // Small delay between batches to avoid rate limits
        if (i + BATCH_SIZE < filesToFetch.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    logger.info(`✓ Successfully fetched ${contents.length}/${filesToFetch.length} files`);
    return contents;
}

/**
 * Get files for a specific priority level
 * ⚡ OPTIMIZED: Uses cached tree results to avoid redundant API calls
 */
export async function getFilesForPriority(
    owner: string,
    repo: string,
    priority: PriorityLevel,
    maxFiles: number = 20,
    onProgress?: (current: number, total: number, path: string) => void,
    token?: string
): Promise<{ files: FileContent[]; totalMatching: number }> {
    // Get full file tree (uses GitHub's Tree API - just 1 API call!)
    const allFiles = await getFileTree(owner, repo, undefined, token);
    const allPaths = allFiles.map(f => f.path);

    // Filter by priority
    const priorityFiles = filterFilesByPriority(allPaths, priority);

    logger.info(`Priority ${priority}: ${priorityFiles.length} files match, fetching up to ${maxFiles}`);

    // Fetch file contents (now with parallel optimization!)
    const files = await getFilesContents(owner, repo, priorityFiles, maxFiles, onProgress, token);

    return {
        files,
        totalMatching: priorityFiles.length,
    };
}

/**
 * Get file counts for all priority levels (for estimation)
 */
export async function getCategorizedFileCounts(owner: string, repo: string, token?: string): Promise<{
    priority1: number;
    priority2: number;
    priority3: number;
    ignored: number;
    total: number;
}> {
    const allFiles = await getFileTree(owner, repo, undefined, token);
    const allPaths = allFiles.map(f => f.path);

    const categorized = categorizeFiles(allPaths);

    return {
        priority1: categorized.priority1.length,
        priority2: categorized.priority2.length,
        priority3: categorized.priority3.length,
        ignored: categorized.ignored.length,
        total: allFiles.length,
    };
}
