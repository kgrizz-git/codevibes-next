import { describe, expect, it } from 'vitest';
import { calculateVibeScore, toStoreIssue } from './analysisIssue';

describe('analysis issue helpers', () => {
  it('normalizes API severity and preserves issue details', () => {
    expect(toStoreIssue({
      id: 'issue-1', severity: 'MEDIUM', category: 'bug', file: 'src/example.ts',
      title: 'Example', description: 'Details', fix: 'Fix it', line: 3,
    })).toMatchObject({ severity: 'important', suggestion: 'Fix it', line: 3 });
  });

  it('calculates the final score from the complete issue snapshot', () => {
    const issues = [
      toStoreIssue({ id: 'critical', severity: 'HIGH', category: 'security', file: 'a', title: 'a', description: 'a' }),
      toStoreIssue({ id: 'important', severity: 'MEDIUM', category: 'bug', file: 'b', title: 'b', description: 'b' }),
    ];
    expect(calculateVibeScore(issues)).toBe(75);
  });
});
