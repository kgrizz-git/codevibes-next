import { describe, expect, it } from 'vitest';
import { parsePositiveWholeNumber, resolveEffortConfig, resolveMaxFilesPerPriority } from './effort.js';

describe('effort configuration', () => {
    it('uses the published quick, standard, and thorough defaults', () => {
        const config = resolveEffortConfig({});

        expect(config).toEqual({
            globalMaxFilesPerPriority: 40,
            maxFilesByEffort: { quick: 5, standard: 20, thorough: 40 },
        });
        expect(resolveMaxFilesPerPriority('quick', config)).toBe(5);
        expect(resolveMaxFilesPerPriority('standard', config)).toBe(20);
        expect(resolveMaxFilesPerPriority('thorough', config)).toBe(40);
    });

    it('treats MAX_FILES_PER_PRIORITY as a global safety cap', () => {
        const config = resolveEffortConfig({ MAX_FILES_PER_PRIORITY: '20' });

        expect(resolveMaxFilesPerPriority('quick', config)).toBe(5);
        expect(resolveMaxFilesPerPriority('standard', config)).toBe(20);
        expect(resolveMaxFilesPerPriority('thorough', config)).toBe(20);
    });

    it('uses the lower of a layer setting and the global safety cap', () => {
        const config = resolveEffortConfig({
            MAX_FILES_PER_PRIORITY: '32',
            EFFORT_QUICK_MAX_FILES: '8',
            EFFORT_STANDARD_MAX_FILES: '24',
            EFFORT_THOROUGH_MAX_FILES: '50',
        });

        expect(resolveMaxFilesPerPriority('quick', config)).toBe(8);
        expect(resolveMaxFilesPerPriority('standard', config)).toBe(24);
        expect(resolveMaxFilesPerPriority('thorough', config)).toBe(32);
    });

    it.each(['0', '-1', '20oops', ' 20', '20.5', 'NaN'])('rejects malformed configuration %p', (value) => {
        expect(() => parsePositiveWholeNumber('MAX_FILES_PER_PRIORITY', value, 40)).toThrow(
            'MAX_FILES_PER_PRIORITY must be a positive whole number',
        );
    });
});
