// ============================================================
// CSRF protection for cookie-authenticated mutating requests
//
// Double-submit: csrf_token cookie plus X-CSRF-Token header.
// Tokens are minted only on safe methods (GET/HEAD/OPTIONS) and
// exposed to handlers via res.locals.csrfToken (JSON body), because
// a cross-origin SPA cannot read a :3001 cookie from document.cookie
// on :8080. Unsafe browser requests must present a header that
// matches a cookie that already exists — never a token minted on
// the same POST. Clients without Origin (curl) skip the check.
// ============================================================

import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function cookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax';
    path: string;
} {
    return {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    };
}

/**
 * Mint csrf_token only on safe methods. Reject unsafe browser
 * requests whose header does not match an existing cookie.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    const existing = typeof req.cookies?.csrf_token === 'string' ? req.cookies.csrf_token : '';

    if (!UNSAFE_METHODS.has(req.method)) {
        let token = existing;
        if (!token) {
            token = randomBytes(32).toString('hex');
            res.cookie(CSRF_COOKIE, token, cookieOptions());
        }
        res.locals.csrfToken = token;
        next();
        return;
    }

    const origin = req.get('origin');
    if (!origin) {
        next();
        return;
    }

    const headerToken = req.get(CSRF_HEADER) || '';
    if (!existing || headerToken !== existing) {
        res.status(403).json({ error: 'Invalid CSRF token' });
        return;
    }

    next();
}
