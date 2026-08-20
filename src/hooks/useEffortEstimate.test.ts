import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '@/lib/api';
import { useEffortEstimate } from './useEffortEstimate';

const priorityCaptures: Record<number, { files: string[]; status: 'pending' }> = {};

function makeUpdatePriority() {
  const calls: Array<{ level: 1 | 2 | 3; files: string[] }> = [];
  const updatePriority = vi.fn((level: 1 | 2 | 3, updates: { files: string[]; status: 'pending' }) => {
    priorityCaptures[level] = updates;
    calls.push({ level, files: updates.files });
  });
  return { updatePriority, calls };
}

function sampleEstimate(effort: api.EffortLevel): api.AnalysisEstimate {
  return {
    repoInfo: {} as api.AnalysisEstimate['repoInfo'],
    priority1: { files: 2, estimatedTokens: 0, estimatedCost: 0 },
    priority2: { files: 3, estimatedTokens: 0, estimatedCost: 0 },
    priority3: { files: 1, estimatedTokens: 0, estimatedCost: 0 },
    totalFiles: 6,
    totalEstimatedTokens: 0,
    totalEstimatedCost: 0,
    effort,
    maxFilesPerPriority: 7,
  };
}

describe('useEffortEstimate', () => {
  beforeEach(() => {
    Object.keys(priorityCaptures).forEach((k) => delete priorityCaptures[Number(k)]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards the selected effort to getEstimate', async () => {
    const getEstimateMock = vi.spyOn(api, 'getEstimate').mockResolvedValue(sampleEstimate('thorough'));
    const { updatePriority } = makeUpdatePriority();
    const { result } = renderHook(() => useEffortEstimate(updatePriority));

    await act(async () => {
      await result.current.load('https://github.com/owner/repo', 'thorough');
    });

    expect(getEstimateMock).toHaveBeenCalledWith('https://github.com/owner/repo', 'thorough');
    expect(result.current.maxFilesPerPriority).toBe(7);
  });

  it('updates only the current response priority placeholders', async () => {
    vi.spyOn(api, 'getEstimate').mockResolvedValue(sampleEstimate('standard'));
    const { updatePriority } = makeUpdatePriority();
    const { result } = renderHook(() => useEffortEstimate(updatePriority));

    await act(async () => {
      await result.current.load('https://github.com/owner/repo', 'standard');
    });

    // Only the three priority levels (1,2,3) are touched, each with 'pending'.
    expect(updatePriority).toHaveBeenCalledTimes(3);
    expect(priorityCaptures[1]).toMatchObject({ files: ['security-file-1', 'security-file-2'], status: 'pending' });
    expect(priorityCaptures[2]).toMatchObject({ files: ['core-file-1', 'core-file-2', 'core-file-3'], status: 'pending' });
    expect(priorityCaptures[3]).toMatchObject({ files: ['support-file-1'], status: 'pending' });
  });

  it('ignores a successful response after invalidate superseded it', async () => {
    let resolveEstimate: (value: api.AnalysisEstimate) => void = () => {};
    const getEstimateMock = vi.spyOn(api, 'getEstimate').mockImplementation(
      () => new Promise<api.AnalysisEstimate>((resolve) => { resolveEstimate = resolve; }),
    );
    const { updatePriority, calls } = makeUpdatePriority();
    const { result } = renderHook(() => useEffortEstimate(updatePriority));

    const loadPromise = result.current.load('https://github.com/owner/repo', 'quick');

    // Supersede the in-flight request before it resolves.
    act(() => { result.current.invalidate(); });
    expect(result.current.maxFilesPerPriority).toBeNull();

    await act(async () => {
      resolveEstimate(sampleEstimate('quick'));
      await loadPromise;
    });

    // The stale success must not have written any priority placeholders.
    expect(calls).toHaveLength(0);
    expect(getEstimateMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an error from a superseded request', async () => {
    let rejectEstimate: (reason: Error) => void = () => {};
    const getEstimateMock = vi.spyOn(api, 'getEstimate').mockImplementation(
      () => new Promise<api.AnalysisEstimate>((_resolve, reject) => { rejectEstimate = reject; }),
    );
    const { updatePriority, calls } = makeUpdatePriority();
    const { result } = renderHook(() => useEffortEstimate(updatePriority));

    const loadPromise = result.current.load('https://github.com/owner/repo', 'quick');

    act(() => { result.current.invalidate(); });

    await act(async () => {
      rejectEstimate(new Error('stale failure'));
      await loadPromise;
    });

    // The error should be swallowed (returns null) rather than thrown.
    await expect(loadPromise).resolves.toBeNull();
    expect(calls).toHaveLength(0);

    // A subsequent non-stale request still surfaces errors.
    getEstimateMock.mockRejectedValueOnce(new Error('fresh failure'));
    await expect(
      act(async () => { await result.current.load('https://github.com/owner/repo', 'standard'); }),
    ).rejects.toThrow('fresh failure');
  });

  it('returns the estimate for the current request', async () => {
    const estimate = sampleEstimate('thorough');
    vi.spyOn(api, 'getEstimate').mockResolvedValue(estimate);
    const { updatePriority } = makeUpdatePriority();
    const { result } = renderHook(() => useEffortEstimate(updatePriority));

    let returned: api.AnalysisEstimate | null = null;
    await act(async () => {
      returned = await result.current.load('https://github.com/owner/repo', 'thorough');
    });

    expect(returned).toBe(estimate);
  });
});
