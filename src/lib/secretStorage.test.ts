import { afterEach, describe, expect, it } from 'vitest';
import {
  API_KEY_STORAGE_KEY,
  decryptSecret,
  encryptSecret,
  readEncryptedSecret,
  takeLegacyZustandApiKey,
  writeEncryptedSecret,
} from './secretStorage';

afterEach(() => {
  localStorage.clear();
});

describe('secretStorage', () => {
  it('round-trips an API key without storing plaintext', async () => {
    const key = 'sk-test-plaintext-key';
    await writeEncryptedSecret(API_KEY_STORAGE_KEY, key);
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(key);
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe(key);
  });

  it('migrates a legacy plaintext sk- key on read', async () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, 'sk-legacy');
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBe('sk-legacy');
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).not.toBe('sk-legacy');
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
    localStorage.setItem('vibeguard_device_key', 'aa'.repeat(32));
    expect(await readEncryptedSecret(API_KEY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });
});
