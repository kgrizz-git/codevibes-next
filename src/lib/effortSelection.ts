import type { EffortLevel, AnalysisEstimate } from './api';
import { parseGitHubRepositoryUrl } from './githubUrl';
import { writeEffortPreference } from './effortPreference';
import { toast } from 'sonner';

export async function refreshEffortEstimate(
  inputUrl: string,
  effort: EffortLevel,
  loadEstimate: (repoUrl: string, effort: EffortLevel) => Promise<AnalysisEstimate | null>,
): Promise<void> {
  const repository = parseGitHubRepositoryUrl(inputUrl);
  if (repository) await loadEstimate(`https://github.com/${repository.owner}/${repository.name}`, effort);
}

export function isEffortSelectorLocked(isAnalyzing: boolean, awaitingApproval: 1 | 2 | null): boolean {
  return isAnalyzing || awaitingApproval !== null;
}

/**
 * Persist the chosen effort and refresh the cost estimate. Extracted from
 * AnalyzePage so the page loses the inline catch branch.
 */
export function applyEffortChange(
  nextEffort: EffortLevel,
  inputUrl: string,
  setEffort: (effort: EffortLevel) => void,
  loadEstimate: (repoUrl: string, effort: EffortLevel) => Promise<AnalysisEstimate | null>,
): void {
  setEffort(nextEffort);
  writeEffortPreference(nextEffort);
  void refreshEffortEstimate(inputUrl, nextEffort, loadEstimate)
    .catch((error: Error) => toast.error(error.message || 'Failed to refresh estimate'));
}
