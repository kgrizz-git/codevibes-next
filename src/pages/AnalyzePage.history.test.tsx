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

vi.mock('@/components/ui/HistoryList', () => ({
  HistoryList: ({ onSelect }: { onSelect: (entry: unknown) => void }) => (
    <button onClick={() => onSelect({
      id: 'history-id',
      repo_url: 'https://github.com/history-owner/history-repo',
      repo_name: 'history-repo',
      repo_full_name: 'history-owner/history-repo',
      issues_count: 0,
      vibe_score: 80,
      tokens_used: 50,
      cost: 0.05,
      issues: [],
      files_scanned: 5,
      duration_ms: 5000,
      effort: 'standard',
      created_at: '2026-08-20T00:00:00.000Z',
    })}>history-repo</button>
  ),
}));

const storeHooks = analysisStoreTestHooks!;
const callbacksByPriority = new Map<api.PriorityLevel, {
  onComplete?: (data: api.CompleteEventData) => void;
}>();
const abortsByPriority = new Map<api.PriorityLevel, ReturnType<typeof vi.fn>>();

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
    vi.clearAllMocks();
    storeHooks.resetApiKeyWriteStateForTests();
    callbacksByPriority.clear();
    abortsByPriority.clear();
    act(() => {
      useAnalysisStore.getState().resetAnalysis();
      useAnalysisStore.setState({ apiKey: 'sk-test', apiKeyHydrated: true, repoUrl: '' });
    });

    vi.mocked(api.validateRepo).mockResolvedValue({ ...estimate.repoInfo, valid: true });
    vi.mocked(api.getEstimate).mockResolvedValue(estimate);
    vi.mocked(api.analyzeRepository).mockImplementation((_url, _key, priority, callbacks) => {
      callbacksByPriority.set(priority, callbacks);
      const abort = vi.fn();
      abortsByPriority.set(priority, abort);
      return { abort };
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

  it('keeps using the starting URL when the input changes at an approval gate', async () => {
    const originalUrl = 'https://github.com/owner/repo';
    const editedUrl = 'https://github.com/other/repository';
    render(<MemoryRouter><AnalyzePage /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: originalUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: /start analysis/i }));

    await waitFor(() => expect(callbacksByPriority.get(1)).toBeDefined());
    await act(async () => { callbacksByPriority.get(1)?.onComplete?.(complete(1)); });
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: editedUrl },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to P2' }));

    await waitFor(() => expect(callbacksByPriority.get(2)).toBeDefined());
    expect(api.analyzeRepository).toHaveBeenNthCalledWith(
      2, originalUrl, 'sk-test', 2, expect.any(Object), 'standard',
    );
    await act(async () => { callbacksByPriority.get(2)?.onComplete?.(complete(2)); });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to P3' }));

    await waitFor(() => expect(callbacksByPriority.get(3)).toBeDefined());
    expect(api.analyzeRepository).toHaveBeenNthCalledWith(
      3, originalUrl, 'sk-test', 3, expect.any(Object), 'standard',
    );
    await act(async () => { callbacksByPriority.get(3)?.onComplete?.(complete(3)); });

    await waitFor(() => expect(api.saveAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: originalUrl,
    })));
  });

  it('cancels an active scan before loading history and ignores its late completion', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'history-repo' }));

    expect(abortsByPriority.get(3)).toHaveBeenCalledOnce();
    await act(async () => { callbacksByPriority.get(3)?.onComplete?.(complete(3)); });

    expect(api.saveAnalysis).not.toHaveBeenCalled();
    expect(useAnalysisStore.getState().repoInfo?.fullName).toBe('history-owner/history-repo');
  });
});
