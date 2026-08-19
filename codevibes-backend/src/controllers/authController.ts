// ============================================================
// Auth Controller - GitHub OAuth flow
// ============================================================

import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { findUserByGithubId, createUser, updateUser } from '../utils/database.js';
import { generateToken, setAuthCookie, clearAuthCookie, type AuthenticatedRequest } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

/**
 * GET /api/auth/github
 * Redirects to GitHub OAuth authorization page
 */
export function redirectToGitHub(_req: Request, res: Response): void {
    if (!GITHUB_CLIENT_ID) {
        res.status(500).json({ error: 'GitHub OAuth is not configured' });
        return;
    }

    const scope = 'user:email repo'; // repo scope for private repos
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_CALLBACK_URL)}&scope=${encodeURIComponent(scope)}`;

    logger.info('Redirecting to GitHub OAuth');
    res.redirect(authUrl);
}

/**
 * GET /api/auth/callback
 * Handles GitHub OAuth callback
 */
export async function handleGitHubCallback(req: Request, res: Response): Promise<void> {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
        res.redirect(`${FRONTEND_URL}?error=missing_code`);
        return;
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: GITHUB_CALLBACK_URL,
            }),
        });

        const tokenData: any = await tokenResponse.json();

        if (tokenData.error) {
            logger.error('GitHub OAuth error', { error: tokenData.error_description });
            res.redirect(`${FRONTEND_URL}?error=${tokenData.error}`);
            return;
        }

        const accessToken = tokenData.access_token;

        // Fetch user info from GitHub
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
            },
        });

        const githubUser: any = await userResponse.json();

        if (!githubUser.id) {
            logger.error('Failed to get GitHub user info');
            res.redirect(`${FRONTEND_URL}?error=user_fetch_failed`);
            return;
        }

        // Check if user exists
        let user = findUserByGithubId(githubUser.id);

        if (user) {
            // Update existing user
            user = updateUser(user.id, {
                username: githubUser.login,
                email: githubUser.email,
                avatar_url: githubUser.avatar_url,
                github_token: accessToken,
            })!;
            logger.info('User logged in', { userId: user.id, username: user.username });
        } else {
            // Create new user
            user = createUser({
                id: uuidv4(),
                github_id: githubUser.id,
                username: githubUser.login,
                email: githubUser.email,
                avatar_url: githubUser.avatar_url,
                github_token: accessToken,
            });
            logger.info('New user created', { userId: user.id, username: user.username });
        }

        // Generate JWT and set cookie
        const token = generateToken({
            userId: user.id,
            githubId: user.github_id,
            username: user.username,
        });

        setAuthCookie(res, token);

        // Redirect to frontend
        res.redirect(`${FRONTEND_URL}/analyze?login=success`);

    } catch (error: any) {
        logger.error('GitHub OAuth callback error', { error: error.message });
        res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
    }
}

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
export function getCurrentUser(req: AuthenticatedRequest, res: Response): void {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    // Don't expose sensitive tokens to frontend
    const { github_token, deepseek_key, ...safeUser } = req.user;

    res.json({
        user: safeUser,
        hasGithubToken: !!github_token,
        hasDeepseekKey: !!deepseek_key,
    });
}

/**
 * POST /api/auth/logout
 * Clear session and logout
 */
export function logout(_req: Request, res: Response): void {
    clearAuthCookie(res);
    res.json({ success: true });
}

/**
 * PUT /api/auth/deepseek-key
 * Save user's DeepSeek API key
 */
export function saveDeepSeekKey(req: AuthenticatedRequest, res: Response): void {
    const { apiKey } = req.body;

    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'API key is required' });
        return;
    }

    updateUser(req.user.id, { deepseek_key: apiKey });
    logger.info('DeepSeek key saved', { userId: req.user.id });

    res.json({ success: true });
}
