// ============================================================
// Auth Utilities - JWT tokens and session management
// ============================================================

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, type User } from './database.js';
import { logger } from './logger.js';
import { decrypt, encrypt, looksEncrypted } from './encryption.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const SESSION_DURATION_DAYS = parseInt(process.env.SESSION_DURATION_DAYS || '30', 10);

export interface JWTPayload {
    userId: string;
    githubId: number;
    username: string;
}

export interface AuthenticatedRequest extends Request {
    user?: User;
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: `${SESSION_DURATION_DAYS}d`,
    });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

/**
 * Read the session JWT from a cookie value. New cookies are AES-256-GCM
 * envelopes; older plaintext JWTs (three base64url parts) still verify.
 */
export function readAuthTokenFromCookieValue(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw) {
        return null;
    }
    if (looksEncrypted(raw)) {
        try {
            return decrypt(raw);
        } catch {
            return null;
        }
    }
    if (raw.split('.').length === 3) {
        return raw;
    }
    return null;
}

function cookieAuthToken(req: Request): string | null {
    return readAuthTokenFromCookieValue(req.cookies?.auth_token);
}

/**
 * Set auth cookie on response
 */
export function setAuthCookie(res: Response, token: string): void {
    res.cookie('auth_token', encrypt(token), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000, // days to ms
        path: '/',
    });
}

/**
 * Clear auth cookie
 */
export function clearAuthCookie(res: Response): void {
    res.cookie('auth_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
    });
}

/**
 * Auth middleware - requires authentication
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const token = cookieAuthToken(req);

    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const payload = verifyToken(token);
    if (!payload) {
        clearAuthCookie(res);
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }

    const user = findUserById(payload.userId);
    if (!user) {
        clearAuthCookie(res);
        res.status(401).json({ error: 'User not found' });
        return;
    }

    req.user = user;
    next();
}

/**
 * Optional auth middleware - populates user if authenticated
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    const token = cookieAuthToken(req);

    if (token) {
        const payload = verifyToken(token);
        if (payload) {
            const user = findUserById(payload.userId);
            if (user) {
                req.user = user;
                logger.info('Auth: User authenticated', {
                    userId: user.id,
                    username: user.username,
                    hasGithubToken: !!user.github_token
                });
            }
        }
    } else {
        logger.info('Auth: No auth_token cookie found');
    }

    next();
}
