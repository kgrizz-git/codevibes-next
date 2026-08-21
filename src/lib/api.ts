// ============================================================
// CodeVibes API Client - Frontend integration with backend
// ============================================================

import { rememberCsrfToken, withCsrfHeaders } from './csrf';

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:3001');

// -------------------- Types --------------------

export interface RepoInfo {
    owner: string;
    name: string;
    fullName: string;
    description: string | null;
    stars: number;
    language: string | null;
    lastUpdate: string;
    defaultBranch: string;
    isPrivate: boolean;
}

export interface ValidateRepoResponse extends RepoInfo {
    valid: boolean;
    error?: string;
}

export interface PriorityEstimate {
    files: number;
    estimatedTokens: number;
    estimatedCost: number;
}

export type EffortLevel = 'quick' | 'standard' | 'thorough';

export interface AnalysisEstimate {
    repoInfo: RepoInfo;
    priority1: PriorityEstimate;
    priority2: PriorityEstimate;
    priority3: PriorityEstimate;
    totalFiles: number;
    totalEstimatedTokens: number;
    totalEstimatedCost: number;
    effort: EffortLevel;
    maxFilesPerPriority: number;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IssueCategory = 'security' | 'bug' | 'performance' | 'quality';
export type PriorityLevel = 1 | 2 | 3;

export interface AnalysisIssue {
    id: string;
    severity: Severity;
    category: IssueCategory;
    file: string;
    line?: number;
    title: string;
    description: string;
    impact?: string;
    fix?: string;
    codeExample?: string;
}

export interface StatusEventData {
    message: string;
    filesScanned: number;
    totalFiles: number;
    currentFile?: string;
}

export interface CompleteEventData {
    priority: PriorityLevel;
    filesScanned: number;
    issuesFound: number;
    tokensUsed: number;
    cost: number;
    effort: EffortLevel;
    nextPriorityEstimate?: PriorityEstimate;
}

export interface ErrorEventData {
    message: string;
    code: string;
    retryable: boolean;
}

export type SSEEventType = 'status' | 'file' | 'issue' | 'complete' | 'error';

export interface SSEEvent {
    type: SSEEventType;
    data: StatusEventData | AnalysisIssue | CompleteEventData | ErrorEventData;
}

// -------------------- API Functions --------------------

/**
 * Validate a GitHub repository URL
 */
export async function validateRepo(repoUrl: string): Promise<ValidateRepoResponse> {
    const response = await fetch(`${API_BASE_URL}/api/validate-repo`, await withCsrfHeaders(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
    }));

    return response.json();
}

/**
 * Get cost estimate for analyzing a repository
 */
export async function getEstimate(repoUrl: string, effort: EffortLevel = 'standard'): Promise<AnalysisEstimate> {
    const params = new URLSearchParams({ repoUrl, effort });
    const response = await fetch(`${API_BASE_URL}/api/estimate?${params.toString()}`, {
        credentials: 'include',  // Send cookies for auth
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get estimate');
    }

    return response.json();
}

/**
 * Run analysis with SSE streaming
 * Returns an EventSource-like interface for receiving events
 */
export function analyzeRepository(
    repoUrl: string,
    apiKey: string,
    priority: PriorityLevel,
    callbacks: {
        onStatus?: (data: StatusEventData) => void;
        onIssue?: (issue: AnalysisIssue) => void;
        onComplete?: (data: CompleteEventData) => void;
        onError?: (error: ErrorEventData) => void;
    },
    effort: EffortLevel = 'standard',
): { abort: () => void } {
    const controller = new AbortController();

    // Use fetch for SSE since native EventSource doesn't support POST
    const runAnalysis = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/analyze`, await withCsrfHeaders(API_BASE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl, apiKey, priority, effort }),
                signal: controller.signal,
            }));

            if (!response.ok) {
                const error = await response.json();
                callbacks.onError?.({
                    message: error.error || 'Analysis failed',
                    code: 'REQUEST_FAILED',
                    retryable: false,
                });
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
                callbacks.onError?.({
                    message: 'Failed to read response stream',
                    code: 'STREAM_ERROR',
                    retryable: false,
                });
                return;
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events from buffer
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim();

                        if (!data || data === ':heartbeat') continue;

                        try {
                            const event: SSEEvent = JSON.parse(data);

                            switch (event.type) {
                                case 'status':
                                    callbacks.onStatus?.(event.data as StatusEventData);
                                    break;
                                case 'issue':
                                    callbacks.onIssue?.(event.data as AnalysisIssue);
                                    break;
                                case 'complete':
                                    callbacks.onComplete?.(event.data as CompleteEventData);
                                    break;
                                case 'error':
                                    callbacks.onError?.(event.data as ErrorEventData);
                                    break;
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                callbacks.onError?.({
                    message: error.message || 'Analysis failed',
                    code: 'NETWORK_ERROR',
                    retryable: true,
                });
            }
        }
    };

    runAnalysis();

    return {
        abort: () => controller.abort(),
    };
}

/**
 * Check API health
 */
export async function checkHealth(): Promise<{ status: string; version: string; csrfToken?: string | null }> {
    const response = await fetch(`${API_BASE_URL}/api/health`, { credentials: 'include' });
    const body = await response.json() as { status: string; version: string; csrfToken?: string | null };
    rememberCsrfToken(body.csrfToken);
    return body;
}

// -------------------- Auth API --------------------

export interface User {
    id: string;
    github_id: number;
    username: string;
    email?: string;
    avatar_url?: string;
    created_at: string;
}

export interface AuthUser {
    user: User;
    hasGithubToken: boolean;
    hasDeepseekKey: boolean;
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            credentials: 'include',
        });

        if (!response.ok) {
            return null;
        }

        return response.json();
    } catch {
        return null;
    }
}

/**
 * Get GitHub OAuth login URL
 */
export function getGitHubLoginUrl(): string {
    return `${API_BASE_URL}/api/auth/github`;
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
    await fetch(`${API_BASE_URL}/api/auth/logout`, await withCsrfHeaders(API_BASE_URL, {
        method: 'POST',
    }));
}

/**
 * Save DeepSeek API key
 */
export async function saveDeepSeekKey(apiKey: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/api/auth/deepseek-key`, await withCsrfHeaders(API_BASE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
    }));

    return response.ok;
}

// -------------------- User Repos API --------------------

export interface UserRepo {
    id: number;
    name: string;
    fullName: string;
    url: string;
    description: string | null;
    isPrivate: boolean;
    stars: number;
    language: string | null;
    updatedAt: string;
}

/**
 * Get authenticated user's repositories
 */
export async function getUserRepos(): Promise<{ repos: UserRepo[] }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/repos`, {
        credentials: 'include',
    });

    if (!response.ok) {
        return { repos: [] };
    }

    return response.json();
}

// -------------------- History API --------------------

export interface HistoryEntry {
    id: string;
    repo_url: string;
    repo_name: string;
    repo_full_name?: string;
    priority?: number;
    issues_count: number;
    vibe_score: number;
    tokens_used: number;
    cost: number;
    issues: AnalysisIssue[];
    files_scanned?: number;
    duration_ms?: number;
    effort?: EffortLevel | null;
    created_at: string;
}

/**
 * Get analysis history
 */
export async function getHistory(limit = 20): Promise<{ analyses: HistoryEntry[] }> {
    const response = await fetch(`${API_BASE_URL}/api/history?limit=${limit}`, {
        credentials: 'include',
    });

    if (!response.ok) {
        return { analyses: [] };
    }

    return response.json();
}

/**
 * Save analysis to history
 */
export async function saveAnalysis(data: {
    repoUrl: string;
    repoName: string;
    repoFullName?: string;
    priority?: number;
    issuesCount: number;
    vibeScore: number;
    tokensUsed: number;
    cost: number;
    filesScanned: number;
    durationMs: number;
    effort: EffortLevel;
    issues: AnalysisIssue[];
}): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/api/history`, await withCsrfHeaders(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }));

    return response.ok;
}

/**
 * Delete analysis from history
 */
export async function deleteAnalysis(id: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/api/history/${id}`, await withCsrfHeaders(API_BASE_URL, {
        method: 'DELETE',
    }));

    return response.ok;
}

/**
 * Get specific analysis
 */
export async function getAnalysis(id: string): Promise<HistoryEntry | null> {
    const response = await fetch(`${API_BASE_URL}/api/history/${id}`, {
        credentials: 'include',
    });

    if (!response.ok) {
        return null;
    }

    return response.json();
}
