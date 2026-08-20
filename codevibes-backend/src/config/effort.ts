// ============================================================
// Analysis effort configuration
// ============================================================

import type { EffortLevel } from '../types/index.js';

export const EFFORT_LEVELS = ['quick', 'standard', 'thorough'] as const;

/**
 * Normalize an incoming saved-effort value. A missing value is supported for
 * callers upgrading in place (returns 'standard'); an explicit valid level is
 * passed through; anything else returns null so the caller can 400.
 */
export function resolveSavedEffort(raw: unknown): EffortLevel | null {
    return raw === undefined ? 'standard' : isEffortLevel(raw) ? raw : null;
}

export interface EffortConfig {
    globalMaxFilesPerPriority: number;
    maxFilesByEffort: Record<EffortLevel, number>;
}

/** Return true only for one of the public, lower-case effort values. */
export function isEffortLevel(value: unknown): value is EffortLevel {
    return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Parse a positive whole-number environment setting without parseInt's
 * permissive partial parsing. Bad deployment configuration must fail at
 * startup instead of silently changing an analysis safety limit.
 */
export function parsePositiveWholeNumber(name: string, value: string | undefined, fallback: number): number {
    if (value === undefined || value === '') return fallback;
    if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(`${name} must be a positive whole number`);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error(`${name} must be a positive whole number`);
    }

    return parsed;
}

/** Resolve the independent layer caps and the administrator safety cap. */
export function resolveEffortConfig(env: NodeJS.ProcessEnv = process.env): EffortConfig {
    return {
        // This needs to be at least the thorough default so a default install
        // can actually select all three published effort levels.
        globalMaxFilesPerPriority: parsePositiveWholeNumber('MAX_FILES_PER_PRIORITY', env.MAX_FILES_PER_PRIORITY, 40),
        maxFilesByEffort: {
            quick: parsePositiveWholeNumber('EFFORT_QUICK_MAX_FILES', env.EFFORT_QUICK_MAX_FILES, 5),
            standard: parsePositiveWholeNumber('EFFORT_STANDARD_MAX_FILES', env.EFFORT_STANDARD_MAX_FILES, 20),
            thorough: parsePositiveWholeNumber('EFFORT_THOROUGH_MAX_FILES', env.EFFORT_THOROUGH_MAX_FILES, 40),
        },
    };
}

const configuredEffort = resolveEffortConfig();

// Kept as a named export for configuration diagnostics and the pipeline
// reference generator. It is a hard upper bound, not the selected layer cap.
export const MAX_FILES_PER_PRIORITY = configuredEffort.globalMaxFilesPerPriority;

/** Return the effective cap after applying the administrator safety maximum. */
export function resolveMaxFilesPerPriority(
    effort: EffortLevel,
    config: EffortConfig = configuredEffort,
): number {
    return Math.min(config.maxFilesByEffort[effort], config.globalMaxFilesPerPriority);
}
