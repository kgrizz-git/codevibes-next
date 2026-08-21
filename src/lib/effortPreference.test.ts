import { describe, expect, it } from 'vitest';
import { EFFORT_PREFERENCE_STORAGE_KEY, readEffortPreference, writeEffortPreference } from './effortPreference';

function memoryStorage(value: string | null = null) {
  let stored = value;
  return {
    getItem: () => stored,
    setItem: (_key: string, next: string) => { stored = next; },
  };
}

describe('effort preference', () => {
  it('uses standard for missing or invalid stored values', () => {
    expect(readEffortPreference(memoryStorage())).toBe('standard');
    expect(readEffortPreference(memoryStorage('max'))).toBe('standard');
  });

  it('accepts and stores public effort levels', () => {
    const storage = memoryStorage();
    writeEffortPreference('thorough', storage);
    expect(readEffortPreference(storage)).toBe('thorough');
    expect(EFFORT_PREFERENCE_STORAGE_KEY).toBe('codevibes.review-effort');
  });
});
