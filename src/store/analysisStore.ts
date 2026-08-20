import { create } from 'zustand';
import {
  API_KEY_STORAGE_KEY,
  clearEncryptedSecret,
  clearLegacyZustandApiKey,
  peekLegacyZustandApiKey,
  readEncryptedSecret,
  writeEncryptedSecret,
} from '@/lib/secretStorage';

export interface AnalysisIssue {
  id: string;
  severity: 'critical' | 'important' | 'nice-to-have';
  title: string;
  description: string;
  file?: string;
  line?: number;
  codeExample?: string;
  suggestion?: string;
  category?: 'security' | 'bug' | 'performance' | 'quality';
}

export interface PriorityLevel {
  level: 1 | 2 | 3;
  name: string;
  description: string;
  files: string[];
  status: 'pending' | 'scanning' | 'complete' | 'skipped';
  issues: AnalysisIssue[];
  tokenCount: number;
}

export interface RepoInfo {
  owner: string;
  name: string;
  fullName: string;
  stars?: number;
  lastUpdate?: string;
  defaultBranch?: string;
}

export interface AnalysisState {
  apiKey: string | null;
  apiKeyHydrated: boolean;
  setApiKey: (key: string | null) => Promise<void>;
  repoUrl: string;
  setRepoUrl: (url: string) => void;
  repoInfo: RepoInfo | null;
  setRepoInfo: (info: RepoInfo | null) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (value: boolean) => void;
  currentPriority: 1 | 2 | 3 | null;
  setCurrentPriority: (level: 1 | 2 | 3 | null) => void;
  priorities: PriorityLevel[];
  setPriorities: (priorities: PriorityLevel[]) => void;
  updatePriority: (level: 1 | 2 | 3, updates: Partial<PriorityLevel>) => void;
  vibeScore: number;
  setVibeScore: (score: number) => void;
  totalTokensUsed: number;
  setTotalTokensUsed: (count: number) => void;
  addTokensUsed: (amount: number) => void;
  filesScanned: number;
  setFilesScanned: (count: number) => void;
  incrementFilesScanned: () => void;
  elapsedTime: number;
  setElapsedTime: (time: number) => void;
  incrementElapsedTime: () => void;
  streamingContent: string;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  awaitingApproval: 1 | 2 | null;
  setAwaitingApproval: (level: 1 | 2 | null) => void;
  resetAnalysis: () => void;
}

const initialPriorities: PriorityLevel[] = [
  { level: 1, name: 'Security & Secrets', description: 'Security files, .env, auth, API keys', files: [], status: 'pending', issues: [], tokenCount: 0 },
  { level: 2, name: 'Core Logic', description: 'Main application logic and business rules', files: [], status: 'pending', issues: [], tokenCount: 0 },
  { level: 3, name: 'Other Files', description: 'Tests, configs, utilities, documentation', files: [], status: 'pending', issues: [], tokenCount: 0 },
];

let apiKeyWriteChain: Promise<void> = Promise.resolve();
let apiKeyMutationGeneration = 0;

export const useAnalysisStore = create<AnalysisState>()((set) => ({
      apiKey: null,
      apiKeyHydrated: false,
      setApiKey: async (key) => {
        apiKeyMutationGeneration += 1;
        const generation = apiKeyMutationGeneration;

        const run = apiKeyWriteChain.then(async () => {
          if (generation !== apiKeyMutationGeneration) {
            return;
          }
          if (key) {
            await writeEncryptedSecret(API_KEY_STORAGE_KEY, key);
            if (generation !== apiKeyMutationGeneration) {
              return;
            }
            clearLegacyZustandApiKey();
          } else {
            clearEncryptedSecret(API_KEY_STORAGE_KEY);
            clearLegacyZustandApiKey();
            if (generation !== apiKeyMutationGeneration) {
              return;
            }
          }
          set({ apiKey: key });
        });

        apiKeyWriteChain = run.catch(() => {});
        await run;
      },
      repoUrl: '',
      setRepoUrl: (url) => set({ repoUrl: url }),
      repoInfo: null,
      setRepoInfo: (info) => set({ repoInfo: info }),
      isAnalyzing: false,
      setIsAnalyzing: (value) => set({ isAnalyzing: value }),
      currentPriority: null,
      setCurrentPriority: (level) => set({ currentPriority: level }),
      priorities: initialPriorities,
      setPriorities: (priorities) => set({ priorities }),
      updatePriority: (level, updates) => set((state) => ({
        priorities: state.priorities.map((p) => p.level === level ? { ...p, ...updates } : p),
      })),
      vibeScore: 0,
      setVibeScore: (score) => set({ vibeScore: score }),
      totalTokensUsed: 0,
      setTotalTokensUsed: (count) => set({ totalTokensUsed: count }),
      addTokensUsed: (amount) => set((state) => ({ totalTokensUsed: state.totalTokensUsed + amount })),
      filesScanned: 0,
      setFilesScanned: (count) => set({ filesScanned: count }),
      incrementFilesScanned: () => set((state) => ({ filesScanned: state.filesScanned + 1 })),
      elapsedTime: 0,
      setElapsedTime: (time) => set({ elapsedTime: time }),
      incrementElapsedTime: () => set((state) => ({ elapsedTime: state.elapsedTime + 1 })),
      streamingContent: '',
      setStreamingContent: (content) => set({ streamingContent: content }),
      appendStreamingContent: (content) => set((state) => ({ streamingContent: state.streamingContent + content })),
      awaitingApproval: null,
      setAwaitingApproval: (level) => set({ awaitingApproval: level }),
      resetAnalysis: () => set({
        isAnalyzing: false, currentPriority: null, priorities: initialPriorities, vibeScore: 0,
        totalTokensUsed: 0, filesScanned: 0, elapsedTime: 0, streamingContent: '', awaitingApproval: null, repoInfo: null,
      }),
}));

/**
 * Load an encrypted (or legacy plaintext) API key into memory once at startup.
 */
export async function hydrateStoredApiKey(): Promise<void> {
  const generationAtStart = apiKeyMutationGeneration;
  try {
    const stored = await readEncryptedSecret(API_KEY_STORAGE_KEY);
    if (
      stored &&
      useAnalysisStore.getState().apiKey === null &&
      generationAtStart === apiKeyMutationGeneration
    ) {
      useAnalysisStore.setState({ apiKey: stored });
      return;
    }
    const legacy = peekLegacyZustandApiKey();
    if (
      legacy &&
      useAnalysisStore.getState().apiKey === null &&
      generationAtStart === apiKeyMutationGeneration
    ) {
      await useAnalysisStore.getState().setApiKey(legacy);
    }
  } catch {
    // Storage blocked or corrupt — leave apiKey null; UI can prompt again.
  } finally {
    useAnalysisStore.setState({ apiKeyHydrated: true });
  }
}

export type AnalysisStoreTestHooks = {
  resetApiKeyWriteStateForTests: () => void;
};

export const analysisStoreTestHooks: AnalysisStoreTestHooks | undefined =
  import.meta.env.MODE === 'test'
    ? {
        resetApiKeyWriteStateForTests: () => {
          apiKeyWriteChain = Promise.resolve();
          apiKeyMutationGeneration = 0;
          useAnalysisStore.setState({ apiKey: null, apiKeyHydrated: false });
        },
      }
    : undefined;
