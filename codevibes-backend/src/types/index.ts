// ============================================================
// CodeVibes Backend - Type Definitions
// ============================================================

// -------------------- Request/Response Types --------------------

export interface AnalyzeRequest {
    repoUrl: string;
    apiKey: string;
    priority: 1 | 2 | 3;
    effort?: EffortLevel;
}

export interface EstimateRequest {
    repoUrl: string;
    effort?: EffortLevel;
}

export interface ValidateRepoRequest {
    repoUrl: string;
}

// -------------------- GitHub Types --------------------

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

export interface FileEntry {
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
}

export interface FileContent {
    path: string;
    content: string;
    size: number;
}

// -------------------- Analysis Types --------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IssueCategory = 'security' | 'bug' | 'performance' | 'quality';
export type PriorityLevel = 1 | 2 | 3;
export type EffortLevel = 'quick' | 'standard' | 'thorough';

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

export interface PriorityEstimate {
    files: number;
    estimatedTokens: number;
    estimatedCost: number;
}

export interface AnalysisEstimate {
    repoInfo: RepoInfo;
    effort: EffortLevel;
    maxFilesPerPriority: number;
    priority1: PriorityEstimate;
    priority2: PriorityEstimate;
    priority3: PriorityEstimate;
    totalFiles: number;
    totalEstimatedTokens: number;
    totalEstimatedCost: number;
}

// -------------------- SSE Event Types --------------------

export type SSEEventType = 'status' | 'file' | 'issue' | 'complete' | 'error';

export interface StatusEventData {
    message: string;
    filesScanned: number;
    totalFiles: number;
    currentFile?: string;
}

export interface FileEventData {
    path: string;
    priority: PriorityLevel;
    status: 'scanning' | 'complete';
}

export type IssueEventData = AnalysisIssue;

export interface CompleteEventData {
    priority: PriorityLevel;
    effort: EffortLevel;
    filesScanned: number;
    issuesFound: number;
    tokensUsed: number;
    cost: number;
    nextPriorityEstimate?: PriorityEstimate;
}

export interface ErrorEventData {
    message: string;
    code: string;
    retryable: boolean;
}

export interface SSEEvent {
    type: SSEEventType;
    data: StatusEventData | FileEventData | IssueEventData | CompleteEventData | ErrorEventData;
}

// -------------------- DeepSeek Types --------------------

export interface DeepSeekMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface DeepSeekStreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        delta: {
            role?: string;
            content?: string;
        };
        finish_reason: string | null;
    }[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

// -------------------- Config Types --------------------

export interface AppConfig {
    port: number;
    allowedOrigins: string[];
    maxFilesPerPriority: number;
    requestTimeoutMs: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    githubToken?: string;
}
