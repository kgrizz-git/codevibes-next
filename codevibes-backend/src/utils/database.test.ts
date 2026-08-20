import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { migrateAnalysisColumns } from './database.js';

describe('analysis database migrations', () => {
    it('adds missing columns and is idempotent after schema inspection', () => {
        const database = new Database(':memory:');
        database.exec('CREATE TABLE analyses (id TEXT PRIMARY KEY)');

        migrateAnalysisColumns(database);
        migrateAnalysisColumns(database);

        expect(database.pragma('table_info(analyses)')).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'files_scanned' }),
                expect.objectContaining({ name: 'duration_ms' }),
                expect.objectContaining({ name: 'effort' }),
            ]),
        );
        database.close();
    });

    it('does not suppress migration failures', () => {
        const exec = vi.fn(() => {
            throw new Error('migration failed');
        });
        const database = {
            pragma: vi.fn(() => []),
            exec,
        } as unknown as Database.Database;

        expect(() => migrateAnalysisColumns(database)).toThrow('migration failed');
        expect(exec).toHaveBeenCalledWith('ALTER TABLE analyses ADD COLUMN files_scanned INTEGER DEFAULT 0');
    });
});
