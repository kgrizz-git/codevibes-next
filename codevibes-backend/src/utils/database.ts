// ============================================================
// Database - SQLite setup with better-sqlite3
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { encrypt, decrypt } from './encryption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/codevibes.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db: import('better-sqlite3').Database = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_id INTEGER UNIQUE NOT NULL,
        username TEXT NOT NULL,
        email TEXT,
        avatar_url TEXT,
        github_token TEXT,
        deepseek_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Analysis history
    CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        repo_url TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        repo_full_name TEXT,
        priority INTEGER,
        issues_count INTEGER DEFAULT 0,
        vibe_score INTEGER DEFAULT 100,
        tokens_used INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        issues_json TEXT,
        files_scanned INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Index for faster queries
    CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);
`);

// Migration: Add new columns if they don't exist
try {
    db.exec('ALTER TABLE analyses ADD COLUMN files_scanned INTEGER DEFAULT 0');
} catch { /* Column likely exists */ }

try {
    db.exec('ALTER TABLE analyses ADD COLUMN duration_ms INTEGER DEFAULT 0');
} catch { /* Column likely exists */ }


logger.info('Database initialized', { path: DB_PATH });

// -------------------- User Operations --------------------

export interface User {
    id: string;
    github_id: number;
    username: string;
    email?: string;
    avatar_url?: string;
    github_token?: string;
    deepseek_key?: string;
    created_at: string;
    updated_at: string;
}

export function findUserByGithubId(githubId: number): User | undefined {
    const user = db.prepare('SELECT * FROM users WHERE github_id = ?').get(githubId) as User | undefined;
    if (user) {
        // Decrypt tokens on read
        if (user.github_token) user.github_token = decrypt(user.github_token);
        if (user.deepseek_key) user.deepseek_key = decrypt(user.deepseek_key);
    }
    return user;
}

export function findUserById(id: string): User | undefined {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    if (user) {
        // Decrypt tokens on read
        if (user.github_token) user.github_token = decrypt(user.github_token);
        if (user.deepseek_key) user.deepseek_key = decrypt(user.deepseek_key);
    }
    return user;
}

export function createUser(user: Omit<User, 'created_at' | 'updated_at'>): User {
    const stmt = db.prepare(`
        INSERT INTO users (id, github_id, username, email, avatar_url, github_token, deepseek_key)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // Encrypt tokens before storage
    const encryptedGithubToken = user.github_token ? encrypt(user.github_token) : null;
    const encryptedDeepseekKey = user.deepseek_key ? encrypt(user.deepseek_key) : null;
    stmt.run(user.id, user.github_id, user.username, user.email, user.avatar_url, encryptedGithubToken, encryptedDeepseekKey);
    return findUserById(user.id)!;
}

export function updateUser(id: string, updates: Partial<Omit<User, 'id' | 'github_id' | 'created_at'>>): User | undefined {
    const fields = Object.keys(updates).filter(k => updates[k as keyof typeof updates] !== undefined);
    if (fields.length === 0) return findUserById(id);

    // Encrypt token fields before storage
    const encryptedUpdates = { ...updates };
    if (encryptedUpdates.github_token) {
        encryptedUpdates.github_token = encrypt(encryptedUpdates.github_token);
    }
    if (encryptedUpdates.deepseek_key) {
        encryptedUpdates.deepseek_key = encrypt(encryptedUpdates.deepseek_key);
    }

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => encryptedUpdates[f as keyof typeof encryptedUpdates]);

    db.prepare(`UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
    return findUserById(id);
}

// -------------------- Analysis Operations --------------------

export interface Analysis {
    id: string;
    user_id: string;
    repo_url: string;
    repo_name: string;
    repo_full_name?: string;
    priority?: number;
    issues_count: number;
    vibe_score: number;
    tokens_used: number;
    cost: number;
    issues_json?: string;
    files_scanned?: number;
    duration_ms?: number;
    created_at: string;
}

export function createAnalysis(analysis: Omit<Analysis, 'created_at'>): Analysis {
    const stmt = db.prepare(`
        INSERT INTO analyses (id, user_id, repo_url, repo_name, repo_full_name, priority, issues_count, vibe_score, tokens_used, cost, issues_json, files_scanned, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        analysis.id,
        analysis.user_id,
        analysis.repo_url,
        analysis.repo_name,
        analysis.repo_full_name,
        analysis.priority,
        analysis.issues_count,
        analysis.vibe_score,
        analysis.tokens_used,
        analysis.cost,
        analysis.issues_json,
        analysis.files_scanned || 0,
        analysis.duration_ms || 0
    );
    return db.prepare('SELECT * FROM analyses WHERE id = ?').get(analysis.id) as Analysis;
}

export function getUserAnalyses(userId: string, limit = 20): Analysis[] {
    return db.prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as Analysis[];
}

export function getAnalysisById(id: string, userId: string): Analysis | undefined {
    return db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(id, userId) as Analysis | undefined;
}

export function deleteAnalysis(id: string, userId: string): boolean {
    const result = db.prepare('DELETE FROM analyses WHERE id = ? AND user_id = ?').run(id, userId);
    return result.changes > 0;
}

export default db;
