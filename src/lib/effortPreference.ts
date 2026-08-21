import type { EffortLevel } from './api';

export const EFFORT_PREFERENCE_STORAGE_KEY = 'codevibes.review-effort';

const effortLevels = new Set<EffortLevel>(['quick', 'standard', 'thorough']);

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && effortLevels.has(value as EffortLevel);
}

export function readEffortPreference(storage: Pick<Storage, 'getItem'> = localStorage): EffortLevel {
  try {
    const value = storage.getItem(EFFORT_PREFERENCE_STORAGE_KEY);
    return isEffortLevel(value) ? value : 'standard';
  } catch {
    return 'standard';
  }
}

export function writeEffortPreference(value: EffortLevel, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(EFFORT_PREFERENCE_STORAGE_KEY, value);
  } catch {
    // Preference storage is optional; the in-memory selection remains usable.
  }
}
