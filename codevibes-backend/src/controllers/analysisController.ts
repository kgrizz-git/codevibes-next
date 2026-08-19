// ============================================================
// Analysis Controller - Request handlers for all API endpoints
// ============================================================

import type { Request, Response } from 'express';
import * as analysisService from '../services/analysisService.js';
import { logger } from '../utils/logger.js';
import { type AuthenticatedRequest, optionalAuth } from '../utils/auth.js';

// Re-export optionalAuth for use in routes
export { optionalAuth };

/**
 * POST /api/analyze
 * Run AI analysis on a GitHub repository with SSE streaming
 */
export async function analyze(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { repoUrl, apiKey, priority } = req.body;

    // Validate required fields
    if (!repoUrl || typeof repoUrl !== 'string') {
        res.status(400).json({ error: 'repoUrl is required' });
        return;
    }

    if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'apiKey is required' });
        return;
    }

    const priorityLevel = parseInt(priority, 10);
    if (![1, 2, 3].includes(priorityLevel)) {
        res.status(400).json({ error: 'priority must be 1, 2, or 3' });
        return;
    }

    // Get user's GitHub token if authenticated
    const githubToken = req.user?.github_token;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Handle client disconnect
    req.on('close', () => {
        logger.info('Client disconnected from SSE stream');
    });

    // Keep connection alive with heartbeats
    const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
            res.write(':heartbeat\n\n');
        }
    }, 15000); // Every 15 seconds

    try {
        logger.request('POST', '/api/analyze', { repoUrl, priority: priorityLevel, hasToken: !!githubToken });

        await analysisService.analyzeRepository(
            res,
            repoUrl,
            apiKey,
            priorityLevel as 1 | 2 | 3,
            githubToken ?? undefined  // Pass user's GitHub token for private repos
        );
    } catch (error: any) {
        logger.error('Analyze endpoint error', { error: error.message });

        // Send error event if stream is still open
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({
                type: 'error',
                data: { message: error.message, code: 'UNEXPECTED_ERROR', retryable: false }
            })}\n\n`);
            res.end();
        }
    } finally {
        clearInterval(heartbeat);
    }
}

/**
 * GET /api/estimate
 * Get cost estimate for analyzing a repository
 */
export async function estimate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const repoUrl = req.query.repoUrl as string;
    const githubToken = req.user?.github_token;

    if (!repoUrl) {
        res.status(400).json({ error: 'repoUrl query parameter is required' });
        return;
    }

    try {
        logger.request('GET', '/api/estimate', { repoUrl, hasToken: !!githubToken });

        const estimateResult = await analysisService.getEstimate(repoUrl, githubToken ?? undefined);
        res.json(estimateResult);
    } catch (error: any) {
        logger.error('Estimate endpoint error', { error: error.message });

        if (error.message.includes('not found')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Failed to estimate analysis' });
        }
    }
}

/**
 * POST /api/validate-repo
 * Validate a GitHub repository URL and get metadata
 */
export async function validateRepo(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { repoUrl } = req.body;
    const githubToken = req.user?.github_token;

    if (!repoUrl || typeof repoUrl !== 'string') {
        res.status(400).json({ error: 'repoUrl is required', valid: false });
        return;
    }

    try {
        logger.request('POST', '/api/validate-repo', { repoUrl, hasToken: !!githubToken });

        const repoInfo = await analysisService.validateRepository(repoUrl, githubToken ?? undefined);

        res.json({
            valid: true,
            ...repoInfo,
        });
    } catch (error: any) {
        logger.error('Validate repo endpoint error', { error: error.message });

        res.status(error.message.includes('not found') ? 404 : 400).json({
            valid: false,
            error: error.message,
        });
    }
}

/**
 * GET /api/health
 * Health check endpoint
 */
export function health(_req: Request, res: Response): void {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
}
