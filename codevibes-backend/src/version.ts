// ============================================================
// App version — single source of truth for API identity
//
// Reads codevibes-backend/package.json so /api/health, the root
// payload, and the GitHub user-agent stay aligned with the
// documented release (currently 1.0.3). Uses createRequire so
// the JSON file can live outside tsc's rootDir (src/).
// ============================================================

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Semver from this package's package.json (no -beta suffix). */
export const APP_VERSION: string = require('../package.json').version;
