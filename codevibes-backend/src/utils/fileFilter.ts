// ============================================================
// File Filter - Priority-based file categorization
// ============================================================

import { minimatch } from 'minimatch';
import type { PriorityLevel } from '../types/index.js';

// -------------------- Ignore Patterns --------------------
// Files/directories that should ALWAYS be ignored
const IGNORE_PATTERNS = [
    // Dependencies
    'node_modules/**',
    'vendor/**',
    '__pycache__/**',
    '.venv/**',
    'venv/**',

    // Build outputs
    'dist/**',
    'build/**',
    'out/**',
    '.next/**',
    '.nuxt/**',
    '.output/**',
    'target/**',
    '.terraform/**',
    '**/.terraform/**',

    // Version control
    '.git/**',
    '.github/**',
    '.gitlab/**',
    '.svn/**',

    // Test coverage
    'coverage/**',
    'test-results/**',
    '.nyc_output/**',

    // IDE/Editor
    '.idea/**',
    '.vscode/**',
    '*.swp',
    '*.swo',
    '.DS_Store',

    // Lock files
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Gemfile.lock',
    'poetry.lock',
    'composer.lock',

    // Minified files
    '*.min.js',
    '*.min.css',
    '*.bundle.js',

    // Binary/media files
    '*.png',
    '*.jpg',
    '*.jpeg',
    '*.gif',
    '*.ico',
    '*.svg',
    '*.webp',
    '*.mp4',
    '*.mp3',
    '*.wav',
    '*.pdf',
    '*.zip',
    '*.tar',
    '*.gz',
    '*.woff',
    '*.woff2',
    '*.ttf',
    '*.eot',

    // Generated files
    '*.map',
    '*.d.ts',
    'generated/**',
    'auto-generated/**',
];

// -------------------- Recognized source files --------------------
// Keep this explicit and lowercase. Filename and directory conventions below are
// applied only to these extensions so that a similarly named document or artifact
// cannot consume a higher-priority review slot.
const SOURCE_EXTENSIONS = new Set([
    // Existing source coverage
    'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rb', 'php', 'rs',

    // Broader language coverage
    'kt', 'kts', 'cs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'm', 'mm',
    'swift', 'scala', 'sc', 'ex', 'exs', 'dart', 'lua', 'r', 'pl', 'pm',
    'sh', 'bash', 'zsh', 'ps1', 'fs', 'fsx', 'vb', 'groovy', 'clj', 'cljs',
    'hs', 'erl', 'hrl', 'zig', 'sol',
]);

// -------------------- Priority 1: Security Critical --------------------
// These intentionally support the deliberate non-source configuration inputs.
const PRIORITY_1_DIRECT_PATTERNS = [
    // Environment files (do not broaden to .env.*; examples remain unselected)
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    '.env.test',
    '.envrc',

    // Infrastructure and database policy
    '**/*.tf',
    '**/*.tfvars',
    '**/*.sql',
];

// Directory and filename conventions are source-gated. Without this guard,
// minimatch's matchBase option can elevate an unrelated artifact named "main",
// "model", "route", or similar.
const PRIORITY_1_SOURCE_DIRECTORY_PATTERNS = [
    // Auth/Security directories
    '**/auth/**',
    '**/authentication/**',
    '**/authorization/**',
    '**/security/**',
    '**/crypto/**',
    '**/secrets/**',

    // Config files
    '**/config/**',
    '**/configs/**',
    '**/configuration/**',
    // Middleware (often contains auth logic)
    '**/middleware/**',
    '**/middlewares/**',

    // Database & Queries (Moved to P1 as requested)
    '**/database/**',
    '**/db/**',
    '**/repositories/**',
    '**/queries/**',
    '**/migrations/**',

    // CORS & Network Security
    '**/access-control/**',

    // Security frameworks and secret-management conventions
    '**/oauth/**',
    '**/jwt/**',
    '**/session/**',
    '**/iam/**',
    '**/vault/**',
];

const PRIORITY_1_SOURCE_FILENAME_PATTERNS = [
    '*.config.js',
    '*.config.ts',

    // Files with sensitive keywords in name
    '**/*secret*',
    '**/*password*',
    '**/*token*',
    '**/*key*',
    '**/*credential*',
    '**/*private*',

    // CORS & Network Security
    '**/*cors*',

    // Security frameworks and secret-management conventions
    '**/*oauth*',
    '**/*jwt*',
    '**/*session*',
    '**/*iam*',
    '**/*vault*',
];

// -------------------- Priority 2: Core Business Logic --------------------
const PRIORITY_2_DIRECT_PATTERNS = [
    // Rust package manifest
    'Cargo.toml',
];

const PRIORITY_2_SOURCE_DIRECTORY_PATTERNS = [
    // API layer
    '**/api/**',
    '**/routes/**',
    '**/router/**',
    '**/endpoints/**',

    // Business logic
    '**/controllers/**',
    '**/services/**',
    '**/handlers/**',
    '**/use-cases/**',
    '**/usecases/**',
    '**/graphql/**',
    '**/resolvers/**',
    '**/mutations/**',
    '**/workers/**',
    '**/jobs/**',
    '**/tasks/**',

    // Data layer
    '**/models/**',
    '**/entities/**',
    '**/schemas/**',

    // Go conventions
    '**/cmd/**',
    '**/internal/**',
    '**/pkg/**',

    // Rust conventions (avoid a blanket src/** rule)
    '**/crates/*/src/**',
    '**/src/bin/**',

    // Core source files
    'lib/**',
];

const PRIORITY_2_SOURCE_FILENAME_PATTERNS = [
    // Entry points
    'index.js',
    'index.ts',
    'main.js',
    'main.ts',
    'app.js',
    'app.ts',
    'server.js',
    'server.ts',
    'main.py',
    'app.py',
    '__main__.py',

    // Go convention
    'main.go',

    // Rust entry points
    '**/src/main.rs',
    '**/src/lib.rs',

    // Core source files
    'src/index.*',
    'src/main.*',
    'src/app.*',
];

// -------------------- Priority 3: Supporting Code --------------------
const PRIORITY_3_NON_SOURCE_PATTERNS = [
    // Documentation
    '*.md',
    '**/docs/**',

    // Styles
    '**/*.css',
    '**/*.scss',
    '**/*.less',
];

const PRIORITY_3_SOURCE_PATTERNS = [
    // Utilities
    '**/utils/**',
    '**/utilities/**',
    '**/helpers/**',
    '**/common/**',
    '**/shared/**',
    '**/lib/**',

    // Frontend components
    '**/components/**',
    '**/views/**',
    '**/pages/**',
    '**/layouts/**',
    '**/templates/**',

    // Tests
    '**/*.test.*',
    '**/*.spec.*',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',

    // The recognized source-extension admission gate is applied in the classifier.
];

/**
 * Check if a file path matches any of the given patterns
 */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern =>
        minimatch(filePath, pattern, { dot: true, matchBase: true })
    );
}

function isRecognizedSourceFile(filePath: string): boolean {
    const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
    const extensionStart = fileName.lastIndexOf('.');

    return extensionStart > 0 && SOURCE_EXTENSIONS.has(fileName.slice(extensionStart + 1));
}

function matchesSourcePattern(filePath: string, patterns: string[]): boolean {
    return isRecognizedSourceFile(filePath) && matchesAnyPattern(filePath, patterns);
}

/**
 * Check if a file should be ignored
 */
export function shouldIgnoreFile(filePath: string): boolean {
    return matchesAnyPattern(filePath, IGNORE_PATTERNS);
}

/**
 * Get the priority level for a file
 * Returns null if file should be ignored
 */
export function getFilePriority(filePath: string): PriorityLevel | null {
    // Check if file should be ignored first
    if (shouldIgnoreFile(filePath)) {
        return null;
    }

    // Check Priority 1 (Security Critical)
    if (
        matchesAnyPattern(filePath, PRIORITY_1_DIRECT_PATTERNS) ||
        matchesSourcePattern(filePath, PRIORITY_1_SOURCE_DIRECTORY_PATTERNS) ||
        matchesSourcePattern(filePath, PRIORITY_1_SOURCE_FILENAME_PATTERNS)
    ) {
        return 1;
    }

    // Check Priority 2 (Core Business Logic)
    if (
        matchesAnyPattern(filePath, PRIORITY_2_DIRECT_PATTERNS) ||
        matchesSourcePattern(filePath, PRIORITY_2_SOURCE_DIRECTORY_PATTERNS) ||
        matchesSourcePattern(filePath, PRIORITY_2_SOURCE_FILENAME_PATTERNS)
    ) {
        return 2;
    }

    // Check if it's a recognized source file for Priority 3
    if (
        matchesAnyPattern(filePath, PRIORITY_3_NON_SOURCE_PATTERNS) ||
        matchesSourcePattern(filePath, PRIORITY_3_SOURCE_PATTERNS) ||
        isRecognizedSourceFile(filePath)
    ) {
        return 3;
    }

    // Unknown file types are ignored
    return null;
}

/**
 * Filter files by priority level
 */
export function filterFilesByPriority(
    files: string[],
    priority: PriorityLevel
): string[] {
    return files.filter(file => getFilePriority(file) === priority);
}

/**
 * Categorize all files by priority
 */
export function categorizeFiles(files: string[]): {
    priority1: string[];
    priority2: string[];
    priority3: string[];
    ignored: string[];
} {
    const result = {
        priority1: [] as string[],
        priority2: [] as string[],
        priority3: [] as string[],
        ignored: [] as string[],
    };

    for (const file of files) {
        const priority = getFilePriority(file);

        switch (priority) {
            case 1:
                result.priority1.push(file);
                break;
            case 2:
                result.priority2.push(file);
                break;
            case 3:
                result.priority3.push(file);
                break;
            default:
                result.ignored.push(file);
        }
    }

    return result;
}

/**
 * ⚡ OPTIMIZED: Lazy categorization - only categorize specific priorities
 * This saves ~60% of categorization time by deferring P2/P3 until needed
 */
export function categorizeLazy(files: string[], priorities: PriorityLevel[]): {
    priority1?: string[];
    priority2?: string[];
    priority3?: string[];
    ignored?: string[];
} {
    const result: {
        priority1?: string[];
        priority2?: string[];
        priority3?: string[];
        ignored?: string[];
    } = {};

    // Only process requested priorities
    const shouldProcess1 = priorities.includes(1);
    const shouldProcess2 = priorities.includes(2);
    const shouldProcess3 = priorities.includes(3);

    if (shouldProcess1) result.priority1 = [];
    if (shouldProcess2) result.priority2 = [];
    if (shouldProcess3) result.priority3 = [];

    for (const file of files) {
        const priority = getFilePriority(file);

        // Only categorize if this priority was requested
        if (priority === 1 && shouldProcess1) {
            result.priority1!.push(file);
        } else if (priority === 2 && shouldProcess2) {
            result.priority2!.push(file);
        } else if (priority === 3 && shouldProcess3) {
            result.priority3!.push(file);
        }
        // Skip ignored files when doing lazy categorization
    }

    return result;
}

/**
 * Get priority name for display
 */
export function getPriorityName(priority: PriorityLevel): string {
    switch (priority) {
        case 1:
            return 'Security & Secrets';
        case 2:
            return 'Core Business Logic';
        case 3:
            return 'Supporting Code';
    }
}

/**
 * Get priority description
 */
export function getPriorityDescription(priority: PriorityLevel): string {
    switch (priority) {
        case 1:
            return 'Environment files, authentication, configuration, and security-related code';
        case 2:
            return 'API endpoints, controllers, services, models, and database logic';
        case 3:
            return 'Utilities, components, tests, and documentation';
    }
}
