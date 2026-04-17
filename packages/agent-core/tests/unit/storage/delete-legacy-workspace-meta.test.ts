import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for `deleteLegacyWorkspaceMetaFiles`. Helper acquires the main DB
 * handle internally via `getDatabase()` (singleton). Each test must call
 * `initializeDatabase` first so the singleton is set — closed between cases.
 *
 * Gate: status='copied' AND stored path === passed path. Anything else is a
 * no-op with the legacy file preserved.
 */

type BetterSqlite3Module = typeof import('better-sqlite3');
type DbModule = typeof import('../../../src/storage/database.js');
type DeleteModule = typeof import('../../../src/storage/delete-legacy-workspace-meta.js');

describe('deleteLegacyWorkspaceMetaFiles', () => {
  let Database: BetterSqlite3Module | null = null;
  let dbModule: DbModule | null = null;
  let deleteModule: DeleteModule | null = null;
  let testDir: string;

  beforeAll(async () => {
    try {
      const m = (await import('better-sqlite3')) as BetterSqlite3Module;
      const probe = new m.default(':memory:');
      probe.close();
      Database = m;
      dbModule = await import('../../../src/storage/database.js');
      deleteModule = await import('../../../src/storage/delete-legacy-workspace-meta.js');
    } catch (err) {
      if (process.env.REQUIRE_SQLITE_TESTS) {
        throw new Error(
          `REQUIRE_SQLITE_TESTS set but better-sqlite3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      console.warn('Skipping delete-legacy tests: better-sqlite3 native module not available');
    }
  });

  beforeEach(() => {
    if (dbModule) {
      try {
        dbModule.closeDatabase();
      } catch {
        /* ignore */
      }
    }
    testDir = path.join(
      os.tmpdir(),
      `del-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (dbModule) {
      try {
        dbModule.closeDatabase();
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  /** Seed a v30 main DB with given status/path and return its absolute path. */
  function seedMainDb(status: string | null, storedPath: string | null): string {
    if (!Database || !dbModule) throw new Error('not available');
    const dbPath = path.join(testDir, `main-${Math.random().toString(36).slice(2)}.db`);
    // Use our own initializeDatabase so the singleton is set.
    dbModule.initializeDatabase({ databasePath: dbPath, runMigrations: true });
    const db = dbModule.getDatabase();
    if (status) {
      db.prepare(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('legacy_meta_import_status', ?)",
      ).run(status);
    }
    if (storedPath !== null) {
      db.prepare(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('legacy_meta_import_path', ?)",
      ).run(storedPath);
    }
    return dbPath;
  }

  function writeTriplet(p: string, includeWal: boolean, includeShm: boolean) {
    fs.writeFileSync(p, Buffer.from('main'));
    if (includeWal) fs.writeFileSync(p + '-wal', Buffer.from('wal'));
    if (includeShm) fs.writeFileSync(p + '-shm', Buffer.from('shm'));
  }

  // --- 1. Non-copied statuses ---
  it.each(['none', 'failed', 'conflict'])('1. Status=%s → files untouched', (status) => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    writeTriplet(legacy, true, true);
    seedMainDb(status, legacy);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.existsSync(legacy + '-wal')).toBe(true);
    expect(fs.existsSync(legacy + '-shm')).toBe(true);
  });

  it('1b. Status missing entirely → files untouched', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    writeTriplet(legacy, true, true);
    seedMainDb(null, null);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.existsSync(legacy + '-wal')).toBe(true);
    expect(fs.existsSync(legacy + '-shm')).toBe(true);
  });

  // --- 2. status=copied, matching path, files don't exist ---
  it('2. Status=copied, matching path, no legacy files → no-op, no error', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    seedMainDb('copied', legacy);
    expect(() => deleteModule!.deleteLegacyWorkspaceMetaFiles(legacy)).not.toThrow();
  });

  // --- 3. Main file only ---
  it('3. Status=copied, main file only exists → main file deleted', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    writeTriplet(legacy, false, false);
    seedMainDb('copied', legacy);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  // --- 4. Full triplet ---
  it('4. Status=copied, full triplet exists → all three deleted', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    writeTriplet(legacy, true, true);
    seedMainDb('copied', legacy);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(legacy + '-wal')).toBe(false);
    expect(fs.existsSync(legacy + '-shm')).toBe(false);
  });

  // --- 5. Only siblings exist ---
  it('5. Status=copied, only -wal/-shm exist → siblings deleted too', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    fs.writeFileSync(legacy + '-wal', Buffer.from('orphan wal'));
    fs.writeFileSync(legacy + '-shm', Buffer.from('orphan shm'));
    seedMainDb('copied', legacy);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    expect(fs.existsSync(legacy + '-wal')).toBe(false);
    expect(fs.existsSync(legacy + '-shm')).toBe(false);
  });

  // --- 7. Idempotent re-run ---
  it('7. Idempotent re-run: two consecutive calls, no error', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    writeTriplet(legacy, true, true);
    seedMainDb('copied', legacy);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(() => deleteModule!.deleteLegacyWorkspaceMetaFiles(legacy)).not.toThrow();
  });

  // --- 8. Path mismatch refuses deletion ---
  it('8. Path mismatch refuses deletion', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const storedPath = path.join(testDir, 'a-legacy.db');
    const otherPath = path.join(testDir, 'b-different.db');
    writeTriplet(storedPath, false, false);
    writeTriplet(otherPath, false, false);
    seedMainDb('copied', storedPath);
    deleteModule.deleteLegacyWorkspaceMetaFiles(otherPath);
    // Neither file should be deleted.
    expect(fs.existsSync(storedPath)).toBe(true);
    expect(fs.existsSync(otherPath)).toBe(true);
  });

  // --- 9. Path missing (corrupt state) ---
  it('9. Status=copied but legacy_meta_import_path missing → no-op', () => {
    if (!Database || !dbModule || !deleteModule) return;
    const legacy = path.join(testDir, 'legacy.db');
    writeTriplet(legacy, false, false);
    seedMainDb('copied', null);
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacy);
    // File preserved — corrupt metadata doesn't trigger destructive action.
    expect(fs.existsSync(legacy)).toBe(true);
  });

  // --- 10. Caller-ordering bug surfaces loudly ---
  it('10. DB not initialized → throws "Database not initialized"', () => {
    if (!Database || !dbModule || !deleteModule) return;
    // No seedMainDb — singleton stays closed.
    const legacy = path.join(testDir, 'legacy.db');
    expect(() => deleteModule!.deleteLegacyWorkspaceMetaFiles(legacy)).toThrow(
      /Database not initialized/,
    );
  });
});
