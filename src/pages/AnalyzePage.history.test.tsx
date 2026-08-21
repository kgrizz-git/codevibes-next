import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import * as api from '@/lib/api';
import { analysisStoreTestHooks, useAnalysisStore } from '@/store/analysisStore';
import AnalyzePage from './AnalyzePage';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: null, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  validateRepo: vi.fn(),
  getEstimate: vi.fn(),
  analyzeRepository: vi.fn(),
  saveAnalysis: vi.fn(),
}));

const storeHooks = analysisStoreTestHooks!;
const callbacksByPriority = new Map<api.PriorityLevel, {
  onComplete?: (data: api.CompleteEventData) => void;
}>();

const estimate: api.AnalysisEstimate = {
  repoInfo: {
    owner: 'owner', name: 'repo', fullName: 'owner/repo', description: null,
    stars: 0, language: null, lastUpdate: '2026-08-20', defaultBranch: 'main', isPrivate: false,
  },
  priority1: { files: 1, estimatedTokens: 10, estimatedCost: 0.01 },
  priority2: { files: 1, estimatedTokens: 10, estimatedCost: 0.01 },
  priority3: { files: 1, estimatedTokens: 10, estimatedCost: 0.01 },
  totalFiles: 3,
  totalEstimatedTokens: 30,
  totalEstimatedCost: 0.03,
  effort: 'standard',
  maxFilesPerPriority: 20,
};

function complete(priority: api.PriorityLevel): api.CompleteEventData {
  return { priority, filesScanned: 1, issuesFound: 0, tokensUsed: 10, cost: 0.01, effort: 'standard' };
}

describe('AnalyzePage history persistence', () => {
  beforeEach(() => {
    storeHooks.resetApiKeyWriteStateForTests();
    callbacksByPriority.clear();
    act(() => {
      useAnalysisStore.getState().resetAnalysis();
      useAnalysisStore.setState({ apiKey: 'sk-test', apiKeyHydrated: true, repoUrl: '' });
    });

    vi.mocked(api.validateRepo).mockResolvedValue({ ...estimate.repoInfo, valid: true });
    vi.mocked(api.getEstimate).mockResolvedValue(estimate);
    vi.mocked(api.analyzeRepository).mockImplementation((_url, _key, priority, callbacks) => {
      callbacksByPriority.set(priority, callbacks);
      return { abort: vi.fn() };
    });
    vi.mocked(api.saveAnalysis).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    storeHooks.resetApiKeyWriteStateForTests();
  });

  it('saves a completed analysis after validating an initially empty repository state', async () => {
    render(<MemoryRouter><AnalyzePage /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/owner/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start analysis/i }));

    await waitFor(() => expect(callbacksByPriority.get(1)).toBeDefined());
    await act(async () => { callbacksByPriority.get(1)?.onComplete?.(complete(1)); });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to P2' }));

    await waitFor(() => expect(callbacksByPriority.get(2)).toBeDefined());
    await act(async () => { callbacksByPriority.get(2)?.onComplete?.(complete(2)); });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to P3' }));

    await waitFor(() => expect(callbacksByPriority.get(3)).toBeDefined());
    await act(async () => { callbacksByPriority.get(3)?.onComplete?.(complete(3)); });

    await waitFor(() => expect(api.saveAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      repoName: 'repo', repoFullName: 'owner/repo', filesScanned: 3,
    })));
  });
});
