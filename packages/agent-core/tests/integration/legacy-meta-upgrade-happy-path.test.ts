import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Irreversibility-budget integration test for the v030 workspace-meta
 * consolidation. Uses REAL better-sqlite3 files on disk — no mocks — to
 * cover the full upgrade path:
 *
 *   1. Seed a pre-consolidation `workspace-meta-dev.db` (legacy schema).
 *   2. Run `initializeDatabase` with both the main DB path and the legacy path.
 *   3. Assert rows landed in the main DB, status + path keys were written.
 *   4. Call `deleteLegacyWorkspaceMetaFiles`.
 *   5. Assert the full legacy triplet is gone.
 *   6. Re-run delete — must be idempotent.
 *
 * Every other test exercises unit-mock boundaries or stops short of actual
 * deletion. This one is required in CI because once delete has run, there's
 * no rollback — we need real files proving the round-trip works end-to-end.
 */

type BetterSqlite3Module = typeof import('better-sqlite3');
type DbModule = typeof import('../../src/storage/database.js');
type DeleteModule = typeof import('../../src/storage/delete-legacy-workspace-meta.js');

const LEGACY_SCHEMA_SQL = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE workspace_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE knowledge_notes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'context',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );
`;

describe('integration: legacy-meta upgrade happy path', () => {
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
      dbModule = await import('../../src/storage/database.js');
      deleteModule = await import('../../src/storage/delete-legacy-workspace-meta.js');
    } catch (err) {
      if (process.env.REQUIRE_SQLITE_TESTS) {
        throw new Error(
          `REQUIRE_SQLITE_TESTS set but better-sqlite3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      console.warn('Skipping integration test: better-sqlite3 native module not available');
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
      `upgrade-hp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  it('imports legacy data, marks status=copied, and cleanly deletes the triplet', () => {
    if (!Database || !dbModule || !deleteModule) return;

    // --- Step 1: build the pre-consolidation legacy DB ---
    const legacyPath = path.join(testDir, 'workspace-meta-dev.db');
    const legacyDb = new Database.default(legacyPath);
    try {
      legacyDb.exec(LEGACY_SCHEMA_SQL);
      legacyDb
        .prepare(
          `INSERT INTO workspaces (id, name, description, color, sort_order, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('ws-A', 'Personal', 'Personal workspace', '#09f', 0, 1, '2024-01-01', '2024-01-01');
      legacyDb
        .prepare(
          `INSERT INTO workspaces (id, name, description, color, sort_order, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('ws-B', 'Work', null, null, 1, 0, '2024-01-01', '2024-01-01');
      legacyDb
        .prepare('INSERT INTO workspace_meta (key, value) VALUES (?, ?)')
        .run('active_workspace_id', 'ws-A');
      // 3 notes: two in workspace A, one in workspace B.
      legacyDb
        .prepare(
          `INSERT INTO knowledge_notes (id, workspace_id, type, content, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('kn-A1', 'ws-A', 'context', 'Prefer 2-space YAML', '2024-01-01', '2024-01-01');
      legacyDb
        .prepare(
          `INSERT INTO knowledge_notes (id, workspace_id, type, content, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('kn-A2', 'ws-A', 'instruction', 'Never commit secrets', '2024-01-01', '2024-01-01');
      legacyDb
        .prepare(
          `INSERT INTO knowledge_notes (id, workspace_id, type, content, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('kn-B1', 'ws-B', 'reference', 'API: https://x', '2024-01-01', '2024-01-01');
    } finally {
      legacyDb.close();
    }

    // --- Step 2: run initializeDatabase with a fresh main DB + the legacy path ---
    const mainPath = path.join(testDir, 'accomplish-dev.db');
    dbModule.initializeDatabase({
      databasePath: mainPath,
      runMigrations: true,
      legacyMetaDbPath: legacyPath,
    });
    const db = dbModule.getDatabase();

    // --- Step 3a: schema_meta keys ---
    const status = (
      db.prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_status'").get() as
        | { value: string }
        | undefined
    )?.value;
    const storedPath = (
      db.prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_path'").get() as
        | { value: string }
        | undefined
    )?.value;
    expect(status).toBe('copied');
    expect(storedPath).toBe(legacyPath);

    // --- Step 3b: rows landed in main DB ---
    const wsCount = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    const notesCount = (
      db.prepare('SELECT COUNT(*) AS n FROM knowledge_notes').get() as { n: number }
    ).n;
    const activePtr = (
      db.prepare("SELECT value FROM workspace_meta WHERE key = 'active_workspace_id'").get() as
        | { value: string }
        | undefined
    )?.value;
    expect(wsCount).toBe(2);
    expect(notesCount).toBe(3);
    expect(activePtr).toBe('ws-A');

    // --- Step 3c: FK integrity on the imported table ---
    const fkViolations = db.prepare('PRAGMA foreign_key_check(knowledge_notes)').all();
    expect(fkViolations).toEqual([]);

    // --- Step 4: deletion mirrors the app-layer sequence ---
    deleteModule.deleteLegacyWorkspaceMetaFiles(legacyPath);

    // --- Step 5: triplet is gone from disk ---
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.existsSync(legacyPath + '-wal')).toBe(false);
    expect(fs.existsSync(legacyPath + '-shm')).toBe(false);

    // --- Step 6: idempotent re-run ---
    expect(() => deleteModule!.deleteLegacyWorkspaceMetaFiles(legacyPath)).not.toThrow();
  });
});
