import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyEffortChange, isEffortSelectorLocked, refreshEffortEstimate } from './effortSelection';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('./effortPreference', () => ({
  writeEffortPreference: vi.fn(),
}));

import { writeEffortPreference } from './effortPreference';

const mockedToast = vi.mocked(toast);
const mockedWrite = vi.mocked(writeEffortPreference);

describe('effortSelection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedToast.error.mockClear();
    mockedWrite.mockClear();
  });

  describe('refreshEffortEstimate', () => {
    it('refreshes and persists the estimate for a valid URL', async () => {
      const loadEstimate = vi.fn().mockResolvedValue({ effort: 'standard' });
      await refreshEffortEstimate('https://github.com/owner/repo', 'thorough', loadEstimate);

      expect(loadEstimate).toHaveBeenCalledTimes(1);
      expect(loadEstimate).toHaveBeenCalledWith('https://github.com/owner/repo', 'thorough');
    });

    it('does not fetch when the URL is not a valid GitHub repository', async () => {
      const loadEstimate = vi.fn().mockResolvedValue(null);
      await refreshEffortEstimate('https://example.com/not-a-repo', 'quick', loadEstimate);

      expect(loadEstimate).not.toHaveBeenCalled();
    });

    it('propagates a load failure to the caller', async () => {
      const loadEstimate = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(
        refreshEffortEstimate('https://github.com/owner/repo', 'standard', loadEstimate),
      ).rejects.toThrow('boom');
    });
  });

  describe('isEffortSelectorLocked', () => {
    it('locks while analyzing', () => {
      expect(isEffortSelectorLocked(true, null)).toBe(true);
    });

    it('locks while awaiting approval', () => {
      expect(isEffortSelectorLocked(false, 1)).toBe(true);
      expect(isEffortSelectorLocked(false, 2)).toBe(true);
    });

    it('unlocks when neither analyzing nor awaiting approval', () => {
      expect(isEffortSelectorLocked(false, null)).toBe(false);
    });
  });

  describe('applyEffortChange', () => {
    it('sets the effort, persists the preference, and refreshes for a valid URL', async () => {
      const setEffort = vi.fn();
      const loadEstimate = vi.fn().mockResolvedValue({ effort: 'thorough' });

      applyEffortChange('thorough', 'https://github.com/owner/repo', setEffort, loadEstimate);

      expect(setEffort).toHaveBeenCalledWith('thorough');
      expect(mockedWrite).toHaveBeenCalledWith('thorough');
      // The refresh is fire-and-forget; yield to let it run.
      await Promise.resolve();
      expect(loadEstimate).toHaveBeenCalledWith('https://github.com/owner/repo', 'thorough');
    });

    it('swallows refresh errors via a toast without throwing', async () => {
      const setEffort = vi.fn();
      const loadEstimate = vi.fn().mockRejectedValue(new Error('refresh failed'));

      expect(() => applyEffortChange('standard', 'https://github.com/owner/repo', setEffort, loadEstimate)).not.toThrow();
      expect(setEffort).toHaveBeenCalledWith('standard');

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockedToast.error).toHaveBeenCalledWith('refresh failed');
    });

    it('does not refresh when the URL is invalid', () => {
      const setEffort = vi.fn();
      const loadEstimate = vi.fn().mockResolvedValue(null);

      applyEffortChange('quick', 'not-a-url', setEffort, loadEstimate);

      expect(setEffort).toHaveBeenCalledWith('quick');
      expect(mockedWrite).toHaveBeenCalledWith('quick');
      expect(loadEstimate).not.toHaveBeenCalled();
    });
  });
});
