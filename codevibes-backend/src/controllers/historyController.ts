// ============================================================
// History Controller - Analysis history management
// ============================================================

import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createAnalysis, getUserAnalyses, getAnalysisById, deleteAnalysis } from '../utils/database.js';
import { type AuthenticatedRequest } from '../utils/auth.js';
import { logger } from '../utils/logger.js';
import { resolveSavedEffort } from '../config/effort.js';

/**
 * POST /api/history
 * Save a new analysis to history
 */
export function saveAnalysis(req: AuthenticatedRequest, res: Response): void {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    const { repoUrl, repoName, repoFullName, priority, effort: requestedEffort, issuesCount, vibeScore, tokensUsed, cost, issues, filesScanned, durationMs } = req.body;

    if (!repoUrl || !repoName) {
        res.status(400).json({ error: 'repoUrl and repoName are required' });
        return;
    }

    // A missing value is supported for callers upgrading in place. Existing
    // database rows remain null so the UI can label them as legacy/unknown.
    const effort = resolveSavedEffort(requestedEffort);
    if (!effort) {
        res.status(400).json({ error: 'effort must be quick, standard, or thorough' });
        return;
    }

    try {
        const analysis = createAnalysis({
            id: uuidv4(),
            user_id: req.user.id,
            repo_url: repoUrl,
            repo_name: repoName,
            repo_full_name: repoFullName,
            priority: priority || null,
            effort,
            issues_count: issuesCount || 0,
            vibe_score: vibeScore || 100,
            tokens_used: tokensUsed || 0,
            cost: cost || 0,
            files_scanned: filesScanned || 0,
            duration_ms: durationMs || 0,
            issues_json: issues ? JSON.stringify(issues) : undefined,
        });

        logger.info('Analysis saved', { userId: req.user.id, analysisId: analysis.id, repoName });

        res.status(201).json({ success: true, analysis });
    } catch (error: any) {
        logger.error('Failed to save analysis', { error: error.message });
        res.status(500).json({ error: 'Failed to save analysis' });
    }
}

/**
 * GET /api/history
 * Get user's analysis history
 */
export function getHistory(req: AuthenticatedRequest, res: Response): void {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 20;
    const analyses = getUserAnalyses(req.user.id, limit);

    // Parse issues JSON for each analysis
    const parsed = analyses.map(a => ({
        ...a,
        issues: a.issues_json ? JSON.parse(a.issues_json) : [],
        issues_json: undefined,
    }));

    res.json({ analyses: parsed });
}

/**
 * GET /api/history/:id
 * Get a specific analysis
 */
export function getAnalysis(req: AuthenticatedRequest, res: Response): void {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    const { id } = req.params;
    const analysis = getAnalysisById(id, req.user.id);

    if (!analysis) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
    }

    res.json({
        ...analysis,
        issues: analysis.issues_json ? JSON.parse(analysis.issues_json) : [],
        issues_json: undefined,
    });
}

/**
 * DELETE /api/history/:id
 * Delete an analysis
 */
export function removeAnalysis(req: AuthenticatedRequest, res: Response): void {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    const { id } = req.params;
    const deleted = deleteAnalysis(id, req.user.id);

    if (!deleted) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
    }

    logger.info('Analysis deleted', { userId: req.user.id, analysisId: id });
    res.json({ success: true });
}
