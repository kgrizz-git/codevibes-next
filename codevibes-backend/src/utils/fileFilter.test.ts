import { describe, it, expect } from 'vitest';
import {
    shouldIgnoreFile,
    getFilePriority,
    filterFilesByPriority,
    categorizeFiles,
    categorizeLazy,
    getPriorityName,
    getPriorityDescription,
} from './fileFilter.js';

describe('shouldIgnoreFile', () => {
    it('ignores lock files, build output and media', () => {
        expect(shouldIgnoreFile('package-lock.json')).toBe(true);
        expect(shouldIgnoreFile('dist/server.js')).toBe(true);
        expect(shouldIgnoreFile('src/logo.png')).toBe(true);
        expect(shouldIgnoreFile('coverage/lcov.info')).toBe(true);
    });

    it('does not ignore ordinary source files', () => {
        expect(shouldIgnoreFile('src/services/analysisService.ts')).toBe(false);
        expect(shouldIgnoreFile('src/components/Button.tsx')).toBe(false);
    });

    it('treats .env.example as NOT ignored (no secret leak risk)', () => {
        expect(shouldIgnoreFile('.env.example')).toBe(false);
    });
});

describe('getFilePriority contracts', () => {
    it('categorises security-adjacent paths as priority 1', () => {
        expect(getFilePriority('.env')).toBe(1);
        expect(getFilePriority('src/auth/login.ts')).toBe(1);
        expect(getFilePriority('src/middleware/cors.ts')).toBe(1);
        expect(getFilePriority('db/migrations/001.sql')).toBe(1);
    });

    it('categorises core logic as priority 2', () => {
        expect(getFilePriority('src/api/routes.ts')).toBe(2);
        expect(getFilePriority('src/controllers/user.ts')).toBe(2);
        expect(getFilePriority('src/services/billing.ts')).toBe(2);
        expect(getFilePriority('src/main.ts')).toBe(2);
    });

    it('categorises supporting code as priority 3', () => {
        expect(getFilePriority('src/utils/format.ts')).toBe(3);
        expect(getFilePriority('src/components/Button.tsx')).toBe(3);
        expect(getFilePriority('README.md')).toBe(3);
        expect(getFilePriority('src/styles/app.css')).toBe(3);
    });

    it('returns null for ignored and unrecognized files', () => {
        expect(getFilePriority('package-lock.json')).toBeNull();
        expect(getFilePriority('src/data.csv')).toBeNull();
    });

    it('prefers the highest-priority match (security beats core)', () => {
        // auth sits under both P1 (**/auth/**) and P2 (**/controllers/...)
        expect(getFilePriority('src/controllers/auth/login.ts')).toBe(1);
    });
});

describe('filterFilesByPriority', () => {
    const files = [
        'src/auth/login.ts',
        'src/api/routes.ts',
        'src/utils/format.ts',
        'package-lock.json',
    ];

    it('returns only files matching the requested priority', () => {
        expect(filterFilesByPriority(files, 1)).toEqual(['src/auth/login.ts']);
        expect(filterFilesByPriority(files, 2)).toEqual(['src/api/routes.ts']);
        expect(filterFilesByPriority(files, 3)).toEqual(['src/utils/format.ts']);
    });
});

describe('categorizeFiles', () => {
    it('partitions files into priority buckets and an ignore list', () => {
        const result = categorizeFiles([
            'src/auth/login.ts',
            'src/api/routes.ts',
            'src/utils/format.ts',
            'package-lock.json',
            'README.md',
            'data.csv',
        ]);

        expect(result.priority1).toEqual(['src/auth/login.ts']);
        expect(result.priority2).toEqual(['src/api/routes.ts']);
        expect(result.priority3).toEqual(['src/utils/format.ts', 'README.md']);
        expect(result.ignored).toEqual(['package-lock.json', 'data.csv']);
    });

    it('returns empty buckets for an empty list', () => {
        const result = categorizeFiles([]);
        expect(result).toEqual({ priority1: [], priority2: [], priority3: [], ignored: [] });
    });
});

describe('categorizeLazy', () => {
    const files = [
        'src/auth/login.ts',
        'src/api/routes.ts',
        'src/utils/format.ts',
        'package-lock.json',
    ];

    it('only categorises the requested priorities', () => {
        const result = categorizeLazy(files, [2, 3]);
        expect(result.priority1).toBeUndefined();
        expect(result.priority2).toEqual(['src/api/routes.ts']);
        expect(result.priority3).toEqual(['src/utils/format.ts']);
        // Ignored files are intentionally skipped by lazy categorization.
        expect(result.ignored).toBeUndefined();
    });

    it('categorises nothing when given an empty priority list', () => {
        expect(categorizeLazy(files, [])).toEqual({});
    });
});

describe('priority display helpers', () => {
    it('return human-readable names and descriptions', () => {
        expect(getPriorityName(1)).toBe('Security & Secrets');
        expect(getPriorityName(2)).toBe('Core Business Logic');
        expect(getPriorityName(3)).toBe('Supporting Code');
        expect(getPriorityDescription(1)).toContain('authentication');
    });
});
