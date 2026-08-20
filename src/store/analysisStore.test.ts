import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY_STORAGE_KEY,
  secretStorageTestHooks,
} from '@/lib/secretStorage';

vi.mock('@/lib/secretStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/secretStorage')>();
  return {
    ...actual,
    readEncryptedSecret: vi.fn(actual.readEncryptedSecret),
    writeEncryptedSecret: vi.fn(actual.writeEncryptedSecret),
  };
});

import * as secretStorage from '@/lib/secretStorage';
import {
  analysisStoreTestHooks,
  hydrateStoredApiKey,
  useAnalysisStore,
} from './analysisStore';

const storageHooks = secretStorageTestHooks!;
const storeHooks = analysisStoreTestHooks!;
const readEncryptedSecret = vi.mocked(secretStorage.readEncryptedSecret);
const writeEncryptedSecretMock = vi.mocked(secretStorage.writeEncryptedSecret);

const realSecretStorage = await vi.importActual<typeof import('@/lib/secretStorage')>(
  '@/lib/secretStorage',
);

beforeEach(() => {
  readEncryptedSecret.mockImplementation(realSecretStorage.readEncryptedSecret);
  writeEncryptedSecretMock.mockImplementation(realSecretStorage.writeEncryptedSecret);
});

afterEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await storageHooks.resetSecretStorageForTests();
  storeHooks.resetApiKeyWriteStateForTests();
});

describe('analysisStore setApiKey ordering', () => {
  it('does not restore a key after a later delete completes', async () => {
    const { setApiKey } = useAnalysisStore.getState();
    let releaseWrite: (() => void) | undefined;
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    writeEncryptedSecretMock.mockImplementation(async (key, value) => {
      await writeBlocked;
      localStorage.setItem(key, `enc:${value}`);
    });

    const savePromise = setApiKey('sk-slow-save');
    await Promise.resolve();
    const deletePromise = setApiKey(null);
    releaseWrite?.();
    await Promise.all([savePromise, deletePromise]);

    expect(useAnalysisStore.getState().apiKey).toBeNull();
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });
});

describe('hydrateStoredApiKey', () => {
  it('does not overwrite a key the user saved during hydration', async () => {
    readEncryptedSecret.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('sk-stale'), 20)),
    );

    const hydratePromise = hydrateStoredApiKey();
    await useAnalysisStore.getState().setApiKey('sk-user-new');
    await hydratePromise;

    expect(useAnalysisStore.getState().apiKey).toBe('sk-user-new');
  });
});
