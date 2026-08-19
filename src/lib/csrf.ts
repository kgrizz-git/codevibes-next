// ============================================================
// Browser CSRF helper — attaches X-CSRF-Token on mutating fetch.
//
// The SPA (Vite :8080) and API (:3001) are cross-origin, so
// document.cookie never sees csrf_token. The token is taken from
// GET /api/health JSON (csrfToken) and kept in memory. Same-origin
// installs can still read the cookie as a fallback.
// ============================================================

const CSRF_COOKIE = 'csrf_token';

let memoryToken: string | null = null;

export function resetCsrfTokenCache(): void {
    memoryToken = null;
}

export function rememberCsrfToken(token: string | null | undefined): void {
    if (typeof token === 'string' && token) {
        memoryToken = token;
    }
}

export function readCsrfToken(): string | null {
    if (typeof document === 'undefined') {
        return null;
    }
    for (const part of document.cookie.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === CSRF_COOKIE) {
            return decodeURIComponent(rest.join('='));
        }
    }
    return null;
}

/**
 * Return a CSRF token from memory, same-origin cookie, or GET /api/health.
 * Throws if none can be obtained — callers must not send the mutation bare.
 */
export async function ensureCsrfToken(apiBaseUrl: string): Promise<string> {
    if (memoryToken) {
        return memoryToken;
    }
    const fromCookie = readCsrfToken();
    if (fromCookie) {
        memoryToken = fromCookie;
        return fromCookie;
    }

    let response: Response;
    try {
        response = await fetch(`${apiBaseUrl}/api/health`, { credentials: 'include' });
    } catch {
        throw new Error('Could not obtain a CSRF token (network error)');
    }
    if (!response.ok) {
        throw new Error('Could not obtain a CSRF token');
    }

    let body: { csrfToken?: unknown } = {};
    try {
        body = (await response.json()) as { csrfToken?: unknown };
    } catch {
        throw new Error('Could not obtain a CSRF token');
    }
    if (typeof body.csrfToken === 'string' && body.csrfToken) {
        memoryToken = body.csrfToken;
        return memoryToken;
    }

    const afterCookie = readCsrfToken();
    if (afterCookie) {
        memoryToken = afterCookie;
        return afterCookie;
    }
    throw new Error('Could not obtain a CSRF token');
}

export async function withCsrfHeaders(
    apiBaseUrl: string,
    init: RequestInit = {}
): Promise<RequestInit> {
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const token = await ensureCsrfToken(apiBaseUrl);
        headers.set('X-CSRF-Token', token);
    }
    return {
        ...init,
        credentials: 'include',
        headers,
    };
}
