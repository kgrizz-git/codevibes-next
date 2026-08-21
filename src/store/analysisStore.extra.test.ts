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
});

afterEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await storageHooks.resetSecretStorageForTests();
    storeHooks.resetApiKeyWriteStateForTests();
});

function state() {
    return useAnalysisStore.getState();
}

describe('analysisStore transitions', () => {
    it('tracks repo url and info', () => {
        state().setRepoUrl('https://github.com/o/r');
        expect(state().repoUrl).toBe('https://github.com/o/r');

        state().setRepoInfo({ owner: 'o', name: 'r', fullName: 'o/r' });
        expect(state().repoInfo?.fullName).toBe('o/r');
    });

    it('counts files and tokens incrementally', () => {
        state().setFilesScanned(2);
        state().incrementFilesScanned();
        expect(state().filesScanned).toBe(3);

        state().setTotalTokensUsed(100);
        state().addTokensUsed(25);
        expect(state().totalTokensUsed).toBe(125);
    });

    it('increments elapsed time', () => {
        state().setElapsedTime(0);
        state().incrementElapsedTime();
        state().incrementElapsedTime();
        expect(state().elapsedTime).toBe(2);
    });

    it('updates a single priority by level without touching others', () => {
        state().updatePriority(2, { status: 'scanning', issues: [{ id: 'x' } as never] });
        const priorities = state().priorities;
        expect(priorities[1].status).toBe('scanning');
        expect(priorities[1].issues).toHaveLength(1);
        expect(priorities[0].status).toBe('pending');
        expect(priorities[2].status).toBe('pending');
    });

    it('appends to streaming content', () => {
        state().setStreamingContent('a');
        state().appendStreamingContent('b');
        expect(state().streamingContent).toBe('ab');
    });

    it('clears analysis state on reset but keeps the api key', async () => {
        await state().setApiKey('sk-keep');
        state().setRepoInfo({ owner: 'o', name: 'r', fullName: 'o/r' });
        state().setVibeScore(80);
        state().addTokensUsed(50);
        state().setCurrentPriority(1);

        state().resetAnalysis();

        expect(state().apiKey).toBe('sk-keep');
        expect(state().repoInfo).toBeNull();
        expect(state().vibeScore).toBe(0);
        expect(state().totalTokensUsed).toBe(0);
        expect(state().totalCost).toBe(0);
        expect(state().currentPriority).toBeNull();
        expect(state().priorities.every((p) => p.status === 'pending')).toBe(true);
    });

    it('sets and clears awaiting approval', () => {
        state().setAwaitingApproval(1);
        expect(state().awaitingApproval).toBe(1);
        state().setAwaitingApproval(null);
        expect(state().awaitingApproval).toBeNull();
    });

    it('sets accumulated cost and resets it with an analysis', () => {
        state().setTotalCost(0.0042);
        expect(state().totalCost).toBeCloseTo(0.0042, 6);
        state().setTotalCost(0.0081);
        expect(state().totalCost).toBeCloseTo(0.0081, 6);

        state().resetAnalysis();
        expect(state().totalCost).toBe(0);
    });
});

describe('vibe score helper', () => {
    it('is computed by the page flow via store setters', () => {
        // Mirror the AnalyzePage scoring rule through store setters.
        const priorities = state().priorities;
        const p1 = { ...priorities[0], issues: [{ severity: 'critical' } as never] };
        const p2 = {
            ...priorities[1],
            issues: [{ severity: 'important' } as never, { severity: 'important' } as never],
        };
        state().setPriorities([p1, p2, priorities[2]]);
        const all = state().priorities.flatMap((p) => p.issues);
        const critical = all.filter((i) => i.severity === 'critical').length;
        const important = all.filter((i) => i.severity === 'important').length;
        state().setVibeScore(Math.max(0, 100 - critical * 20 - important * 5));
        expect(state().vibeScore).toBe(70);
    });
});

describe('hydrateStoredApiKey', () => {
    it('leaves apiKey null when nothing is stored', async () => {
        readEncryptedSecret.mockResolvedValue(null);
        await hydrateStoredApiKey();
        expect(useAnalysisStore.getState().apiKey).toBeNull();
        expect(useAnalysisStore.getState().apiKeyHydrated).toBe(true);
    });

    it('falls back to a legacy plaintext key', async () => {
        readEncryptedSecret.mockResolvedValue(null);
        // peekLegacyZustandApiKey reads a zustand persist blob keyed by state.apiKey.
        localStorage.setItem(
            'codevibes-storage',
            JSON.stringify({ state: { apiKey: 'sk-legacy' }, version: 0 }),
        );
        await hydrateStoredApiKey();
        expect(useAnalysisStore.getState().apiKey).toBe('sk-legacy');
    });
});
