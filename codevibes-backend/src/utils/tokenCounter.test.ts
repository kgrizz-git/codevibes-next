import { describe, it, expect } from 'vitest';
import {
    estimateTokens,
    estimateTokensForFiles,
    calculateCost,
    formatCost,
    estimateOutputTokens,
    getFullEstimate,
} from './tokenCounter.js';

describe('estimateTokens', () => {
    it('returns 0 for empty input', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('uses a ~4 char per token ceiling', () => {
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcde')).toBe(2);
        expect(estimateTokens('a'.repeat(40))).toBe(10);
    });
});

describe('estimateTokensForFiles', () => {
    it('sums per-file estimates', () => {
        expect(estimateTokensForFiles(['abcd', 'abcdefgh'])).toBe(1 + 2);
        expect(estimateTokensForFiles([])).toBe(0);
    });
});

describe('calculateCost', () => {
    it('prices input and output independently per million tokens', () => {
        // 1M input @ 0.14, 1M output @ 0.28 => 0.42
        expect(calculateCost(1_000_000, 1_000_000)).toBeCloseTo(0.42, 10);
    });

    it('returns 0 for no tokens', () => {
        expect(calculateCost(0, 0)).toBe(0);
    });
});

describe('estimateOutputTokens', () => {
    it('estimates ~20% of input tokens, rounded up', () => {
        expect(estimateOutputTokens(10)).toBe(2);
        expect(estimateOutputTokens(3)).toBe(1);
        expect(estimateOutputTokens(0)).toBe(0);
    });
});

describe('getFullEstimate', () => {
    it('derives input, output, total and cost consistently', () => {
        const result = getFullEstimate(['abcdefgh']);
        expect(result.inputTokens).toBe(2);
        expect(result.outputTokens).toBe(estimateOutputTokens(2));
        expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
        expect(result.estimatedCost).toBeCloseTo(
            calculateCost(result.inputTokens, result.outputTokens),
            10,
        );
    });
});

describe('formatCost', () => {
    it('prefixes a dollar sign with six decimal places', () => {
        expect(formatCost(0)).toBe('$0.000000');
        expect(formatCost(0.42)).toBe('$0.420000');
    });
});
