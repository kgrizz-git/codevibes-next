// ============================================================
// Analysis Service - Orchestrates the full analysis workflow
// ============================================================

import type { Response } from 'express';
import type {
    PriorityLevel,
    SSEEvent,
    StatusEventData,
    FileEventData,
    IssueEventData,
    CompleteEventData,
    ErrorEventData,
    AnalysisEstimate,
    RepoInfo
} from '../types/index.js';
import * as githubService from './githubService.js';
import * as deepseekService from './deepseekService.js';
import { calculateCost } from '../utils/tokenCounter.js';
import { getPriorityName } from '../utils/fileFilter.js';
import { logger } from '../utils/logger.js';

const MAX_FILES_PER_PRIORITY = parseInt(process.env.MAX_FILES_PER_PRIORITY || '20', 10);

// -------------------- SSE Helpers --------------------

/**
 * Send an SSE event to the client
 */
function sendSSE(res: Response, event: SSEEvent): void {
    if (res.writableEnded) return;

    const data = JSON.stringify(event);
    res.write(`data: ${data}\n\n`);
}

/**
 * Send a status update
 */
function sendStatus(res: Response, message: string, filesScanned: number, totalFiles: number, currentFile?: string): void {
    const data: StatusEventData = { message, filesScanned, totalFiles, currentFile };
    sendSSE(res, { type: 'status', data });
}

/**
 * Send a file scanning event
 */
function sendFileEvent(res: Response, path: string, priority: PriorityLevel, status: 'scanning' | 'complete'): void {
    const data: FileEventData = { path, priority, status };
    sendSSE(res, { type: 'file', data });
}

/**
 * Send an issue found event
 */
function sendIssue(res: Response, issue: IssueEventData): void {
    sendSSE(res, { type: 'issue', data: issue });
}

/**
 * Send completion event
 */
function sendComplete(res: Response, data: CompleteEventData): void {
    sendSSE(res, { type: 'complete', data });
}

/**
 * Send error event
 */
function sendError(res: Response, message: string, code: string, retryable: boolean = false): void {
    const data: ErrorEventData = { message, code, retryable };
    sendSSE(res, { type: 'error', data });
}

// -------------------- Analysis Functions --------------------

/**
 * Run analysis for a specific priority level
 * Streams results via SSE
 */
export async function analyzeRepository(
    res: Response,
    repoUrl: string,
    apiKey: string,
    priority: PriorityLevel,
    githubToken?: string  // User's OAuth token for private repo access
): Promise<void> {
    const startTime = Date.now();

    try {
        // Parse GitHub URL
        const parsed = githubService.parseGitHubUrl(repoUrl);
        if (!parsed) {
            sendError(res, 'Invalid GitHub URL format', 'INVALID_URL');
            res.end();
            return;
        }

        const { owner, repo } = parsed;

        // Validate repository
        sendStatus(res, 'Validating repository...', 0, 0);

        let repoInfo: RepoInfo;
        try {
            repoInfo = await githubService.validateRepo(owner, repo, githubToken);
        } catch (error: any) {
            sendError(res, error.message, 'REPO_NOT_FOUND');
            res.end();
            return;
        }

        // Private repos require user token
        if (repoInfo.isPrivate && !githubToken) {
            sendError(res, 'Private repositories require login', 'PRIVATE_REPO');
            res.end();
            return;
        }

        // Get files for this priority
        sendStatus(res, `Scanning ${getPriorityName(priority)} files...`, 0, 0);

        const { files } = await githubService.getFilesForPriority(
            owner,
            repo,
            priority,
            MAX_FILES_PER_PRIORITY,
            (current, total, path) => {
                sendStatus(res, `Fetching files... (${current}/${total})`, current, total, path);
                sendFileEvent(res, path, priority, 'scanning');
            },
            githubToken  // Pass user's token for private repo access
        );

        if (files.length === 0) {
            sendStatus(res, `No files found for Priority ${priority}`, 0, 0);
            sendComplete(res, {
                priority,
                filesScanned: 0,
                issuesFound: 0,
                tokensUsed: 0,
                cost: 0,
            });
            res.end();
            return;
        }

        // Mark files as fetched
        for (const file of files) {
            sendFileEvent(res, file.path, priority, 'complete');
        }

        // Analyze with DeepSeek
        sendStatus(res, `Analyzing ${files.length} files with AI...`, files.length, files.length);

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let allIssues: IssueEventData[] = [];

        // Use streaming for real-time updates
        const stream = deepseekService.streamAnalysis(files, apiKey, priority);

        for await (const event of stream) {
            if (event.type === 'chunk') {
                // Optionally send streaming content updates
                // (For now we wait for complete response)
            } else if (event.type === 'complete') {
                totalInputTokens = event.inputTokens || 0;
                totalOutputTokens = event.outputTokens || 0;
                allIssues = event.issues || [];

                // Send each issue individually for real-time UI updates
                for (const issue of allIssues) {
                    sendIssue(res, issue);
                }
            }
        }

        const totalCost = calculateCost(totalInputTokens, totalOutputTokens);
        const totalTokens = totalInputTokens + totalOutputTokens;

        // Calculate next priority estimate if not at P3
        let nextPriorityEstimate;
        if (priority < 3) {
            const nextPriority = (priority + 1) as PriorityLevel;
            const nextFiles = await githubService.getFilesForPriority(owner, repo, nextPriority, MAX_FILES_PER_PRIORITY, undefined, githubToken);
            const avgTokensPerFile = totalInputTokens / files.length || 500;
            const estimatedTokens = Math.ceil(nextFiles.files.length * avgTokensPerFile);

            nextPriorityEstimate = {
                files: nextFiles.totalMatching,
                estimatedTokens,
                estimatedCost: calculateCost(estimatedTokens, estimatedTokens * 0.2),
            };
        }

        // Send completion event
        sendComplete(res, {
            priority,
            filesScanned: files.length,
            issuesFound: allIssues.length,
            tokensUsed: totalTokens,
            cost: totalCost,
            nextPriorityEstimate,
        });

        const duration = Date.now() - startTime;
        logger.info('Analysis complete', {
            repo: `${owner}/${repo}`,
            priority,
            files: files.length,
            issues: allIssues.length,
            tokens: totalTokens,
            cost: totalCost,
            durationMs: duration,
        });

    } catch (error: any) {
        logger.error('Analysis failed', { error: error.message, repoUrl, priority });

        if (error.message.includes('API key')) {
            sendError(res, error.message, 'INVALID_API_KEY');
        } else if (error.message.includes('rate limit')) {
            sendError(res, error.message, 'RATE_LIMITED', true);
        } else {
            sendError(res, `Analysis failed: ${error.message}`, 'ANALYSIS_ERROR');
        }
    } finally {
        res.end();
    }
}

/**
 * Get analysis estimate without running full analysis
 */
export async function getEstimate(repoUrl: string, githubToken?: string): Promise<AnalysisEstimate> {
    // Parse GitHub URL
    const parsed = githubService.parseGitHubUrl(repoUrl);
    if (!parsed) {
        throw new Error('Invalid GitHub URL format');
    }

    const { owner, repo } = parsed;

    // Validate repository
    const repoInfo = await githubService.validateRepo(owner, repo, githubToken);

    // Private repos require user token
    if (repoInfo.isPrivate && !githubToken) {
        throw new Error('Private repositories require login');
    }

    // Get file counts by priority
    const counts = await githubService.getCategorizedFileCounts(owner, repo, githubToken);

    // Estimate tokens (rough average of 500 tokens per file)
    const AVG_TOKENS_PER_FILE = 500;
    const OUTPUT_RATIO = 0.2;

    const p1Files = Math.min(counts.priority1, MAX_FILES_PER_PRIORITY);
    const p2Files = Math.min(counts.priority2, MAX_FILES_PER_PRIORITY);
    const p3Files = Math.min(counts.priority3, MAX_FILES_PER_PRIORITY);

    const p1Tokens = p1Files * AVG_TOKENS_PER_FILE;
    const p2Tokens = p2Files * AVG_TOKENS_PER_FILE;
    const p3Tokens = p3Files * AVG_TOKENS_PER_FILE;

    const priority1 = {
        files: p1Files,
        estimatedTokens: p1Tokens,
        estimatedCost: calculateCost(p1Tokens, p1Tokens * OUTPUT_RATIO),
    };

    const priority2 = {
        files: p2Files,
        estimatedTokens: p2Tokens,
        estimatedCost: calculateCost(p2Tokens, p2Tokens * OUTPUT_RATIO),
    };

    const priority3 = {
        files: p3Files,
        estimatedTokens: p3Tokens,
        estimatedCost: calculateCost(p3Tokens, p3Tokens * OUTPUT_RATIO),
    };

    const totalFiles = p1Files + p2Files + p3Files;
    const totalEstimatedTokens = p1Tokens + p2Tokens + p3Tokens;
    const totalEstimatedCost = priority1.estimatedCost + priority2.estimatedCost + priority3.estimatedCost;

    return {
        repoInfo,
        priority1,
        priority2,
        priority3,
        totalFiles,
        totalEstimatedTokens,
        totalEstimatedCost,
    };
}

/**
 * Validate a GitHub repository URL
 */
export async function validateRepository(repoUrl: string, githubToken?: string): Promise<RepoInfo> {
    const parsed = githubService.parseGitHubUrl(repoUrl);
    if (!parsed) {
        throw new Error('Invalid GitHub URL format');
    }

    const { owner, repo } = parsed;
    return githubService.validateRepo(owner, repo, githubToken);
}
