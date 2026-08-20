import { afterEach, describe, expect, it } from 'vitest';
import {
  API_KEY_STORAGE_KEY,
  decryptSecret,
  encryptSecret,
  peekLegacyZustandApiKey,
  readEncryptedSecret,
  secretStorageTestHooks,
  takeLegacyZustandApiKey,
  writeEncryptedSecret,
} from './secretStorage';

const hooks = secretStorageTestHooks!;

afterEach(async () => {
  localStorage.clear();
  await hooks.resetSecretStorageForTests();
});

describe('secretStorage', () => {
  it('round-trips an API key without storing plaintext or the wrapping key in localStorage', async () => {
    const key = 'sk-test-plaintext-key';
    await writeEncryptedSecret(API_KEY_STORAGE_KEY, key);
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(key);
    expect(localStorage.getItem('vibeguard_device_key')).toBeNull();
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe(key);
  });

  it('migrates a legacy plaintext sk- key on read', async () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, 'sk-legacy');
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe('sk-legacy');
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).not.toBe('sk-legacy');
  });

  it('peeks a plaintext key from the old zustand persist blob without deleting it', () => {
    localStorage.setItem(
      'codevibes-storage',
      JSON.stringify({ state: { apiKey: 'sk-from-zustand' }, version: 0 })
    );
    expect(peekLegacyZustandApiKey()).toBe('sk-from-zustand');
    const leftover = JSON.parse(localStorage.getItem('codevibes-storage') || '{}');
    expect(leftover.state.apiKey).toBe('sk-from-zustand');
  });

  it('pulls a plaintext key out of the old zustand persist blob', () => {
    localStorage.setItem(
      'codevibes-storage',
      JSON.stringify({ state: { apiKey: 'sk-from-zustand' }, version: 0 })
    );
    expect(takeLegacyZustandApiKey()).toBe('sk-from-zustand');
    const leftover = JSON.parse(localStorage.getItem('codevibes-storage') || '{}');
    expect(leftover.state.apiKey).toBeUndefined();
  });

  it('encryptSecret output decrypts with decryptSecret', async () => {
    const cipher = await encryptSecret('hello');
    expect(cipher).toContain(':');
    expect(await decryptSecret(cipher)).toBe('hello');
  });

  it('clears ciphertext when the device key no longer decrypts it', async () => {
    await writeEncryptedSecret(API_KEY_STORAGE_KEY, 'sk-original');
    await hooks.replaceWrappingKeyForTests(new Uint8Array(32).fill(0xaa));
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it('uses one wrapping key for concurrent encrypt calls', async () => {
    const [a, b] = await Promise.all([
      encryptSecret('sk-a'),
      encryptSecret('sk-b'),
    ]);
    expect(await decryptSecret(a)).toBe('sk-a');
    expect(await decryptSecret(b)).toBe('sk-b');
  });

  it('migrates a legacy localStorage wrapping key into IndexedDB and removes the legacy slot', async () => {
    const legacyHex = 'ab'.repeat(32);
    localStorage.setItem('vibeguard_device_key', legacyHex);
    hooks.resetMemoryWrapCacheForTests();

    await writeEncryptedSecret(API_KEY_STORAGE_KEY, 'sk-migrated-wrap');

    expect(localStorage.getItem('vibeguard_device_key')).toBeNull();
    hooks.resetMemoryWrapCacheForTests();
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe('sk-migrated-wrap');
  });

  it('falls back to localStorage for the wrapping key when IndexedDB writes fail', async () => {
    hooks.blockIdbWritesForTests(true);
    await writeEncryptedSecret(API_KEY_STORAGE_KEY, 'sk-fallback-wrap');
    const legacyWrap = localStorage.getItem('vibeguard_device_key');
    expect(legacyWrap).toMatch(/^[0-9a-f]{64}$/i);

    hooks.resetMemoryWrapCacheForTests();
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe('sk-fallback-wrap');
  });

  it('persists one wrapping key when concurrent callers race through IndexedDB', async () => {
    const raceLoad = async (label: string) => {
      hooks.resetMemoryWrapCacheForTests();
      return encryptSecret(label);
    };

    const [a, b] = await Promise.all([raceLoad('sk-race-a'), raceLoad('sk-race-b')]);

    hooks.resetMemoryWrapCacheForTests();
    expect(await decryptSecret(a)).toBe('sk-race-a');
    expect(await decryptSecret(b)).toBe('sk-race-b');
  });

  it('keeps the active localStorage fallback when IndexedDB recovers with a stale key', async () => {
    await hooks.replaceWrappingKeyForTests(new Uint8Array(32).fill(0xaa));
    hooks.blockIdbWritesForTests(true);
    hooks.resetMemoryWrapCacheForTests();

    await writeEncryptedSecret(API_KEY_STORAGE_KEY, 'sk-recovery');
    expect(localStorage.getItem('vibeguard_device_key')).toMatch(/^[0-9a-f]{64}$/i);

    hooks.blockIdbWritesForTests(false);
    hooks.resetMemoryWrapCacheForTests();
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe('sk-recovery');
  });
});
