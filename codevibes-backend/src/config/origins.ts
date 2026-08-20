// ============================================================
// Allowed CORS origins — credentialed responses (including CSRF
// tokens) are only readable by these SPA origins.
// ============================================================

const DEFAULT_ORIGINS =
    'http://localhost:5173,http://localhost:3000,http://localhost:8080,' +
    'http://127.0.0.1:5173,http://127.0.0.1:3000,http://127.0.0.1:8080';

export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/**
 * Missing Origin (curl, same-origin GET) is allowed for CORS reflection.
 * Only explicitly listed origins pass; `*` is not supported.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) {
        return true;
    }
    return ALLOWED_ORIGINS.includes(origin);
}
