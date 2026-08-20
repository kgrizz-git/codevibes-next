import type * as api from '@/lib/api';
import type { AnalysisIssue } from '@/store/analysisStore';

function mapSeverity(severity: string): AnalysisIssue['severity'] {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH': return 'critical';
    case 'MEDIUM':
    case 'MODERATE': return 'important';
    default: return 'nice-to-have';
  }
}

export function toStoreIssue(issue: api.AnalysisIssue): AnalysisIssue {
  return {
    id: issue.id,
    severity: mapSeverity(issue.severity),
    title: issue.title,
    description: issue.description,
    file: issue.file,
    line: issue.line,
    codeExample: issue.codeExample,
    suggestion: issue.fix,
    category: issue.category,
  };
}

export function calculateVibeScore(issues: AnalysisIssue[]): number {
  const critical = issues.filter((issue) => issue.severity === 'critical').length;
  const important = issues.filter((issue) => issue.severity === 'important').length;
  return Math.max(0, 100 - critical * 20 - important * 5);
}
