import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for `importLegacyWorkspaceMeta`. All cases require better-sqlite3
 * native bindings; skipped gracefully if unavailable.
 *
 * Status key space:
 *   missing  → first opportunity (helper may write a terminal value)
 *   'none'   → helper ran, nothing to import (terminal)
 *   'copied' → import succeeded (terminal; deletion helper may proceed)
 *   'conflict' → refused because destination tables had rows (terminal)
 *   'failed' → open/copy/verify threw (terminal; manual recovery required)
 */

type BetterSqlite3Module = typeof import('better-sqlite3');
type ImportModule = typeof import('../../../src/storage/import-legacy-workspace-meta.js');
type MigrationModule =
  typeof import('../../../src/storage/migrations/v030-workspace-meta-consolidation.js');

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

describe('importLegacyWorkspaceMeta', () => {
  let Database: BetterSqlite3Module | null = null;
  let importModule: ImportModule | null = null;
  let migrationModule: MigrationModule | null = null;
  let testDir: string;
  let instances: Array<{ close: () => void }> = [];

  beforeAll(async () => {
    try {
      const m = (await import('better-sqlite3')) as BetterSqlite3Module;
      const probe = new m.default(':memory:');
      probe.close();
      Database = m;
      importModule = await import('../../../src/storage/import-legacy-workspace-meta.js');
      migrationModule =
        await import('../../../src/storage/migrations/v030-workspace-meta-consolidation.js');
    } catch (err) {
      if (process.env.REQUIRE_SQLITE_TESTS) {
        throw new Error(
          `REQUIRE_SQLITE_TESTS set but better-sqlite3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      console.warn('Skipping import-legacy tests: better-sqlite3 native module not available');
    }
  });

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `import-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    for (const db of instances) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    instances = [];
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  /** Build a v30 main DB with schema_meta + the three consolidated tables. */
  function openMainDb(name = 'main') {
    if (!Database || !migrationModule) throw new Error('better-sqlite3 not available');
    const dbPath = path.join(testDir, `${name}-${Date.now()}.db`);
    const db = new Database.default(dbPath);
    instances.push(db);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', '30')").run();
    migrationModule.migration.up(db);
    return db;
  }

  /** Build a legacy DB file populated via the legacy schema. */
  function buildLegacyDb(
    opts: {
      workspaces?: Array<Record<string, unknown>>;
      workspace_meta?: Array<{ key: string; value: string }>;
      knowledge_notes?: Array<Record<string, unknown>>;
      skipTables?: Array<'workspaces' | 'workspace_meta' | 'knowledge_notes'>;
    } = {},
  ): string {
    if (!Database) throw new Error('better-sqlite3 not available');
    const p = path.join(testDir, `legacy-${Math.random().toString(36).slice(2)}.db`);
    const db = new Database.default(p);
    instances.push(db);
    db.pragma('foreign_keys = OFF'); // allow seeded rows that would violate FK

    let schema = LEGACY_SCHEMA_SQL;
    if (opts.skipTables) {
      for (const t of opts.skipTables) {
        schema = schema.replace(new RegExp(`CREATE TABLE ${t}[^;]+;`, 's'), '');
      }
    }
    db.exec(schema);

    for (const w of opts.workspaces ?? []) {
      db.prepare(
        `INSERT INTO workspaces (id, name, description, color, sort_order, is_default, created_at, updated_at)
           VALUES (@id, @name, @description, @color, @sort_order, @is_default, @created_at, @updated_at)`,
      ).run({
        description: null,
        color: null,
        sort_order: 0,
        is_default: 0,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        ...w,
      });
    }
    for (const m of opts.workspace_meta ?? []) {
      db.prepare('INSERT INTO workspace_meta (key, value) VALUES (?, ?)').run(m.key, m.value);
    }
    for (const n of opts.knowledge_notes ?? []) {
      db.prepare(
        `INSERT INTO knowledge_notes (id, workspace_id, type, content, created_at, updated_at)
           VALUES (@id, @workspace_id, @type, @content, @created_at, @updated_at)`,
      ).run({
        type: 'context',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        ...n,
      });
    }
    db.close();
    return p;
  }

  function readStatus(db: { prepare: (s: string) => { get: () => unknown } }): string | undefined {
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_status'")
      .get() as { value: string } | undefined;
    return row?.value;
  }
  function readPath(db: { prepare: (s: string) => { get: () => unknown } }): string | undefined {
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_path'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  // --- 1. No path provided ---
  it('1. No path provided, status missing → no-op', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    importModule.importLegacyWorkspaceMeta(db, undefined, 29);
    expect(readStatus(db)).toBeUndefined();
    expect(readPath(db)).toBeUndefined();
  });

  // --- 2/3. File missing, upgrade boot ---
  it('2. Path provided, file missing, preMigrationVersion=29 → status=none', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    importModule.importLegacyWorkspaceMeta(db, path.join(testDir, 'nope.db'), 29);
    expect(readStatus(db)).toBe('none');
    expect(readPath(db)).toBeUndefined(); // path only written on 'copied'
  });

  it('3. Path provided, file missing, preMigrationVersion=30 → silent no-op', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    importModule.importLegacyWorkspaceMeta(db, path.join(testDir, 'nope.db'), 30);
    expect(readStatus(db)).toBeUndefined();
  });

  // --- 4. Zero-byte file ---
  it('4. Whole-triplet empty (main zero-byte + -wal/-shm absent), preMigrationVersion=29 → status=none', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const p = path.join(testDir, 'zero.db');
    fs.writeFileSync(p, Buffer.alloc(0));
    importModule.importLegacyWorkspaceMeta(db, p, 29);
    expect(readStatus(db)).toBe('none');
    // The zero-byte file should have been unlinked inline.
    expect(fs.existsSync(p)).toBe(false);
  });

  // --- 5. Non-SQLite blob ---
  it('5. Non-SQLite blob → open throws in both strategies → status=failed', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const p = path.join(testDir, 'blob.db');
    fs.writeFileSync(p, Buffer.from('this is not a sqlite file, just random bytes'));
    importModule.importLegacyWorkspaceMeta(db, p, 29);
    expect(readStatus(db)).toBe('failed');
    // Legacy file preserved for manual recovery.
    expect(fs.existsSync(p)).toBe(true);
  });

  // --- 6. Happy path ---
  it('6. Seeded legacy file (all three tables populated) → status=copied, path stored', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacy = buildLegacyDb({
      workspaces: [
        { id: 'ws-1', name: 'Personal', is_default: 1 },
        { id: 'ws-2', name: 'Work' },
      ],
      workspace_meta: [{ key: 'active_workspace_id', value: 'ws-1' }],
      knowledge_notes: [
        { id: 'kn-1', workspace_id: 'ws-1', content: 'Use 2-space YAML' },
        { id: 'kn-2', workspace_id: 'ws-2', content: 'API docs: x' },
      ],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);

    expect(readStatus(db)).toBe('copied');
    expect(readPath(db)).toBe(legacy);

    const wsCount = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    const notesCount = (
      db.prepare('SELECT COUNT(*) AS n FROM knowledge_notes').get() as { n: number }
    ).n;
    expect(wsCount).toBe(2);
    expect(notesCount).toBe(2);

    const active = db
      .prepare("SELECT value FROM workspace_meta WHERE key = 'active_workspace_id'")
      .get() as { value: string } | undefined;
    expect(active?.value).toBe('ws-1');
  });

  // --- 7. Optional table missing ---
  it('7. Legacy missing optional knowledge_notes table → workspaces copied, status=copied', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacy = buildLegacyDb({
      workspaces: [{ id: 'ws-1', name: 'Solo' }],
      skipTables: ['knowledge_notes'],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('copied');
    const wsCount = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    expect(wsCount).toBe(1);
  });

  // --- 8. Required table missing ---
  it('8. Legacy missing required workspaces table → status=failed, rollback', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacy = buildLegacyDb({
      skipTables: ['workspaces'],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('failed');
    const wsCount = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    expect(wsCount).toBe(0);
  });

  // --- 9. Count mismatch (defensive branch) ---
  it('9. count-mismatch branch is defensive against INSERT OR IGNORE skips', () => {
    // Rationale: with the three-table conflict guard active, the main DB
    // is empty before import runs, so INSERT OR IGNORE can only skip a row
    // if it collides with ANOTHER LEGACY row (duplicate PK / UNIQUE) — and
    // SQLite's own UNIQUE constraint prevents seeding such a legacy DB in
    // the first place. The count-mismatch `throw` inside the import is
    // therefore defense-in-depth against a future code change that might
    // introduce skips some other way (e.g. relaxing the conflict guard or
    // adding a partial unique index later). Documenting here so the branch
    // isn't deleted as "unreachable".
    //
    // This test asserts the branch EXISTS (static check against the source)
    // rather than trying to exercise it at runtime.
    if (!Database || !importModule) return;
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../src/storage/import-legacy-workspace-meta.ts'),
      'utf8',
    );
    expect(src).toMatch(/inserted !== rows\.length/);
    expect(src).toMatch(/copy incomplete:/);
  });

  // --- 10. Terminal status no-op ---
  it('10. Terminal status (copied/none/conflict/failed) → no work done', () => {
    if (!Database || !importModule) return;
    for (const terminal of ['copied', 'none', 'conflict', 'failed'] as const) {
      const db = openMainDb(`term-${terminal}`);
      db.prepare(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('legacy_meta_import_status', ?)",
      ).run(terminal);
      const legacy = buildLegacyDb({ workspaces: [{ id: 'ws-1', name: 'X' }] });
      importModule.importLegacyWorkspaceMeta(db, legacy, 29);
      expect(readStatus(db)).toBe(terminal);
      const n = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
      expect(n).toBe(0);
    }
  });

  // --- 11. active_workspace_id preserved end-to-end ---
  it('11. workspace_meta.active_workspace_id preserved end-to-end', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacy = buildLegacyDb({
      workspaces: [{ id: 'ws-42', name: 'Forty-Two' }],
      workspace_meta: [{ key: 'active_workspace_id', value: 'ws-42' }],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('copied');
    const active = db
      .prepare("SELECT value FROM workspace_meta WHERE key = 'active_workspace_id'")
      .get() as { value: string };
    expect(active.value).toBe('ws-42');
  });

  // --- 13. Conflict guard ---
  it('13. Preexisting workspace row in main DB → status=conflict, no copy', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    db.prepare(
      'INSERT INTO workspaces (id, name, sort_order, is_default, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)',
    ).run('existing-ws', 'Existing', 'now', 'now');
    const legacy = buildLegacyDb({ workspaces: [{ id: 'ws-legacy', name: 'Legacy' }] });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('conflict');
    // Legacy rows should NOT have been copied; only 'existing-ws' remains.
    const names = (db.prepare('SELECT name FROM workspaces').all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(names).toEqual(['Existing']);
  });

  it('13b. Preexisting workspace_meta row only → status=conflict', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    db.prepare('INSERT INTO workspace_meta (key, value) VALUES (?, ?)').run(
      'active_workspace_id',
      'stale-ptr',
    );
    const legacy = buildLegacyDb({ workspaces: [{ id: 'ws-1', name: 'L' }] });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('conflict');
  });

  // --- 14. Named-parameter binding ---
  it('14. Row with NULL description copies correctly (named-param binding)', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacy = buildLegacyDb({
      workspaces: [{ id: 'ws-null', name: 'NoDesc', description: null }],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('copied');
    const row = db.prepare("SELECT description FROM workspaces WHERE id='ws-null'").get() as {
      description: string | null;
    };
    expect(row.description).toBeNull();
  });

  // --- 18. Post-import FK violation ---
  it('18. knowledge_notes row referencing missing workspace → status=failed', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    // Legacy has a note referencing a workspace that was NOT copied
    // (because the workspace row isn't in legacy either).
    const legacy = buildLegacyDb({
      workspaces: [{ id: 'ws-1', name: 'A' }],
      knowledge_notes: [{ id: 'kn-orphan', workspace_id: 'ws-ghost', content: 'orphan' }],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    // Either the INSERT fails (FK-on-insert) or the post-copy FK check
    // fails. Both paths write status='failed'.
    expect(readStatus(db)).toBe('failed');
    // Nothing should have been copied (tx rolled back).
    const wsCount = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    expect(wsCount).toBe(0);
  });

  // --- 18b. Unrelated pre-existing FK issue ignored ---
  it('18b. Unrelated FK violation in another table does not fail import', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    // Create a contrived unrelated FK scenario: task_messages references
    // tasks(id), but we insert a task_messages row with no matching task.
    // Use FK-off during setup to sneak the bad row in.
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS task_messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
    `);
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO task_messages (id, task_id) VALUES (?, ?)').run('msg-1', 'ghost-task');
    db.pragma('foreign_keys = ON');

    const legacy = buildLegacyDb({ workspaces: [{ id: 'ws-ok', name: 'OK' }] });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    // Scoped FK check on knowledge_notes ignores the unrelated task_messages
    // violation. Import should succeed.
    expect(readStatus(db)).toBe('copied');
  });

  // --- Dangling active_workspace_id ---
  it('Dangling active_workspace_id → status=failed, rollback', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacy = buildLegacyDb({
      workspaces: [{ id: 'ws-1', name: 'A' }],
      workspace_meta: [{ key: 'active_workspace_id', value: 'ws-ghost' }],
    });
    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('failed');
  });

  // --- 18e. Zero-byte main + non-empty WAL does NOT inline-delete ---
  it('18e. Zero-byte main + non-empty WAL preserves the main file (no inline-delete)', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    const legacyPath = path.join(testDir, 'zero-main-wal-bytes.db');
    fs.writeFileSync(legacyPath, Buffer.alloc(0)); // zero-byte main
    // -wal with some bytes (not a valid SQLite WAL, but exists and non-empty).
    // The key contract we're proving: the whole-triplet-empty short-circuit
    // does NOT fire (because walSize > 0), so unlinkLegacyTriplet is never
    // invoked. openLegacy then attempts the open; whether it succeeds or
    // fails is SQLite's business (and SQLite may rewrite the -wal on open
    // since our fake content isn't a valid WAL header — that's normal).
    // What matters: the main file survives so a user can recover.
    fs.writeFileSync(legacyPath + '-wal', Buffer.from('non-empty fake wal content'));

    importModule.importLegacyWorkspaceMeta(db, legacyPath, 29);

    // Copy failed (no workspaces table in the fake DB) → status='failed'.
    expect(readStatus(db)).toBe('failed');
    // Crucial: the main file was NOT inline-deleted by the empty-triplet
    // branch. SQLite may have initialized it as an empty valid DB, but
    // the file is still on disk — the helper didn't destroy user data.
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  // --- 18f. -shm alone does not count as recoverable content ---
  it('18f. Zero-byte main + missing/zero -wal + non-empty -shm → still whole-triplet empty', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('18f');
    const legacyPath = path.join(testDir, 'shm-only.db');
    fs.writeFileSync(legacyPath, Buffer.alloc(0)); // zero-byte main
    // No -wal file at all.
    // -shm is non-empty. In WAL mode, -shm is a shared-memory mirror that
    // SQLite regenerates from the main + -wal on every open — its bytes
    // are never the source of truth. The helper deliberately ignores
    // -shm size when deciding "is the triplet empty", and this test
    // pins that invariant: even a hefty -shm blob should NOT prevent
    // the inline cleanup path.
    fs.writeFileSync(legacyPath + '-shm', Buffer.alloc(32768, 0xab));

    importModule.importLegacyWorkspaceMeta(db, legacyPath, 29);

    // Whole-triplet-empty short-circuit fired → status='none' on upgrade boot.
    expect(readStatus(db)).toBe('none');
    // Cleanup removed all siblings (including the orphan -shm).
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.existsSync(legacyPath + '-shm')).toBe(false);
    // No path key is written — path is only recorded on status='copied'.
    expect(readPath(db)).toBeUndefined();
  });

  // --- 18h. whole-triplet empty on post-consolidation boot (preMigrationVersion=30) ---
  it('18h. Whole-triplet empty + preMigrationVersion=30 → cleanup runs, NO status write', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('18h');
    const legacyPath = path.join(testDir, 'stray-post-v30.db');
    // Zero-byte main + zero-byte wal + non-empty shm — same "whole-triplet
    // empty" condition as 18f, but simulating a post-consolidation boot
    // where the main DB already ran v30 previously. The cleanup step
    // should still run (we don't want stray empty files lingering), but
    // the helper must NOT record a terminal 'none' status — that's only
    // written on the original upgrade boot (preMigrationVersion < 30).
    fs.writeFileSync(legacyPath, Buffer.alloc(0));
    fs.writeFileSync(legacyPath + '-wal', Buffer.alloc(0));
    fs.writeFileSync(legacyPath + '-shm', Buffer.alloc(64, 0x01));

    importModule.importLegacyWorkspaceMeta(db, legacyPath, 30);

    // Status key was NOT written — leaving it missing so a later expert
    // recovery (e.g. dropping a restored legacy DB into place) can
    // re-trigger the import on a subsequent boot.
    expect(readStatus(db)).toBeUndefined();
    // But files WERE cleaned up — we still honor the one-DB-on-disk
    // outcome regardless of whether we record a terminal state.
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.existsSync(legacyPath + '-wal')).toBe(false);
    expect(fs.existsSync(legacyPath + '-shm')).toBe(false);
  });

  // --- 17. Single-transaction rollback coverage ---
  //
  // Earlier tests (#8 "required table missing", #18 "FK violation") pin
  // status='failed' on various error paths. This case specifically pins
  // the single-outer-transaction atomicity promise: a failure AFTER the
  // first required table inserted rows must roll back those rows so
  // main DB ends up empty, not half-populated.
  //
  // Reproduction: seed legacy with a valid `workspaces` table (copies
  // successfully) + a `knowledge_notes` row whose `workspace_id` points
  // at a non-existent workspace. With foreign_keys=ON on the main DB,
  // either the INSERT into knowledge_notes throws FK-at-insert time or
  // the post-copy `PRAGMA foreign_key_check(knowledge_notes)` throws.
  // Either way the OUTER IMMEDIATE transaction aborts and the earlier
  // `workspaces` INSERT must be undone as well.
  it('17. Rollback after first table succeeded but later step failed → workspaces empty, status=failed', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('rollback');
    const legacy = buildLegacyDb({
      workspaces: [
        { id: 'ws-a', name: 'Alpha' },
        { id: 'ws-b', name: 'Beta' },
      ],
      workspace_meta: [{ key: 'active_workspace_id', value: 'ws-a' }],
      // One note references a real workspace (ws-a), another references a ghost.
      knowledge_notes: [
        { id: 'kn-valid', workspace_id: 'ws-a', content: 'valid' },
        { id: 'kn-orphan', workspace_id: 'ws-ghost', content: 'will explode main DB' },
      ],
    });

    importModule.importLegacyWorkspaceMeta(db, legacy, 29);

    // Outcome: tx rolled back → status='failed' (terminal).
    expect(readStatus(db)).toBe('failed');

    // Critical atomicity check: the `workspaces` INSERT succeeded earlier
    // in the loop but must be undone by the rollback. Without the outer
    // IMMEDIATE tx wrapping everything, the main DB would end up with
    // ws-a + ws-b in it despite the import having "failed" — leaving a
    // half-populated dataset that downstream queries would see.
    const wsCount = (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    expect(wsCount).toBe(0);
    const metaCount = (
      db.prepare('SELECT COUNT(*) AS n FROM workspace_meta').get() as { n: number }
    ).n;
    expect(metaCount).toBe(0);
    const notesCount = (
      db.prepare('SELECT COUNT(*) AS n FROM knowledge_notes').get() as { n: number }
    ).n;
    expect(notesCount).toBe(0);

    // Legacy file preserved for manual recovery.
    expect(fs.existsSync(legacy)).toBe(true);
  });

  // --- 18g. statSync throws — force `safeFileState` to return 'unknown' ---
  //
  // The original plan called for two subcases to fully pin the contract:
  //   - unknown stat + valid legacy file → status='copied' (open succeeds,
  //     import runs, NOT 'none' and NOT 'failed')
  //   - unknown stat + bad legacy file   → status='failed' (open throws,
  //     outer catch writes 'failed', NOT 'none')
  //
  // The shared invariant: regardless of whether the open succeeds, the
  // helper must NEVER collapse an 'unknown' stat into 'none'. Writing
  // 'none' would bake a terminal "nothing to do" state over an
  // inaccessible-but-potentially-recoverable legacy DB.

  async function withStatSyncThrowingFor(
    targetPath: string,
    errCode: string,
    fn: () => Promise<void> | void,
  ): Promise<void> {
    const { default: fsModule } = await import('fs');
    const realStatSync = fsModule.statSync;
    const statSpy = vi.spyOn(fsModule, 'statSync').mockImplementation(((p: fs.PathLike) => {
      if (p === targetPath) {
        const err = new Error(`${errCode}: simulated for test`) as NodeJS.ErrnoException;
        err.code = errCode;
        throw err;
      }
      return realStatSync(p as fs.PathLike);
    }) as typeof fsModule.statSync);
    try {
      await fn();
    } finally {
      statSpy.mockRestore();
    }
  }

  it('18g(a). statSync EACCES + valid legacy DB → status=copied (open still succeeds; never none)', async () => {
    if (!Database || !importModule) return;
    const db = openMainDb('unknown-valid');
    const legacyPath = path.join(testDir, 'eacces-valid.db');
    const seededLegacy = buildLegacyDb({ workspaces: [{ id: 'ws-ok', name: 'Valid' }] });
    fs.copyFileSync(seededLegacy, legacyPath);

    await withStatSyncThrowingFor(legacyPath, 'EACCES', () => {
      importModule!.importLegacyWorkspaceMeta(db, legacyPath, 29);
    });

    // Contract (primary): unknown → fall through to import path; helper
    // never writes 'none' based on a stat that didn't resolve.
    expect(readStatus(db)).not.toBe('none');
    // Contract (secondary): since the legacy file is actually valid and
    // readable, openLegacy + import should succeed — we observed 'copied',
    // proving the fallthrough actually runs the import rather than
    // silently short-circuiting.
    expect(readStatus(db)).toBe('copied');
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('18g(b). statSync EACCES + invalid legacy file → status=failed (open throws; still never none)', async () => {
    if (!Database || !importModule) return;
    const db = openMainDb('unknown-invalid');
    const legacyPath = path.join(testDir, 'eacces-garbage.db');
    // Not a valid SQLite file; openLegacy will throw.
    fs.writeFileSync(legacyPath, Buffer.from('definitely not sqlite content'));

    await withStatSyncThrowingFor(legacyPath, 'EACCES', () => {
      importModule!.importLegacyWorkspaceMeta(db, legacyPath, 29);
    });

    // Contract (primary — same as 18g(a)): unknown must not collapse to 'none'.
    expect(readStatus(db)).not.toBe('none');
    // Contract (secondary): open fails → outer catch writes 'failed'. This
    // distinguishes from 18g(a)'s 'copied' outcome and rules out the
    // regression where a valid-import path would silently land in 'failed'.
    expect(readStatus(db)).toBe('failed');
    // The legacy file is preserved for manual recovery.
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  // --- 18i. Cleanup failure leaves status missing ---
  it('18i. unlinkLegacyTriplet failure (simulated via read-only file) leaves status missing', () => {
    if (!Database || !importModule) return;
    const db = openMainDb();
    // Create a zero-byte main file in a read-only directory to make unlink
    // fail with EACCES. Doing so reliably on macOS requires chmod tricks
    // that don't work for the test runner's own uid. Instead, fake the
    // failure by marking the file itself read-only on a path whose parent
    // directory has no write permission for the user.
    const readonlyDir = path.join(testDir, 'ro-dir');
    fs.mkdirSync(readonlyDir);
    const legacyPath = path.join(readonlyDir, 'zero.db');
    fs.writeFileSync(legacyPath, Buffer.alloc(0));
    // Remove write perms from the directory (on the parent to prevent unlink).
    fs.chmodSync(readonlyDir, 0o555);
    try {
      importModule.importLegacyWorkspaceMeta(db, legacyPath, 29);
      // unlinkLegacyTriplet should have failed with EACCES; the helper
      // must NOT write status='none' because a terminal status would
      // permanently bake in the stale-file state.
      expect(readStatus(db)).toBeUndefined();
      // File still exists (couldn't be unlinked).
      expect(fs.existsSync(legacyPath)).toBe(true);
    } finally {
      // Restore write perms so afterEach() can clean up.
      fs.chmodSync(readonlyDir, 0o755);
    }
  });

  // --- 18j. runMigrations=false bypasses import ---
  it('18j. initializeDatabase(..., runMigrations: false) skips import helper', async () => {
    if (!Database) return;
    // Use the real initializeDatabase wrapper (not the helper directly) to
    // prove the `shouldRunMigrations && legacyMetaDbPath` gate in database.ts
    // prevents import from running when migrations are disabled.
    const dbModule = await import('../../../src/storage/database.js');
    const mainPath = path.join(testDir, 'no-migrations.db');
    // Seed a legacy file that WOULD be imported if the helper ran.
    const legacyPath = buildLegacyDb({
      workspaces: [{ id: 'ws-x', name: 'X' }],
    });
    try {
      dbModule.initializeDatabase({
        databasePath: mainPath,
        runMigrations: false,
        legacyMetaDbPath: legacyPath,
      });
      const db = dbModule.getDatabase();
      // No schema_meta table exists because migrations didn't run. The
      // helper's readStatus() gracefully returns undefined in that case
      // and the gate in database.ts should have skipped the call entirely
      // anyway. Either way, no import-related side effects should exist.
      const hasSchemaMeta = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`)
        .get();
      expect(hasSchemaMeta).toBeUndefined();
      // Legacy file untouched.
      expect(fs.existsSync(legacyPath)).toBe(true);
    } finally {
      dbModule.closeDatabase();
    }
  });

  // --- CONCURRENCY: atomic terminal-write guard (direct) ---
  // Tests the guard via the exported `__testing.atomicWriteTerminalStatus`
  // symbol. The higher-level helper short-circuits at its fast-path before
  // reaching the guard when status is already terminal — the only realistic
  // way the guard matters is a race where a losing worker arrives at the
  // outer catch with stale status knowledge. Exercising it directly proves
  // the regression would bite.
  it('atomicWriteTerminalStatus: refuses to write when status is already terminal', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('race-direct');
    // Simulate Process A having committed status='copied'.
    db.prepare(
      "INSERT INTO schema_meta (key, value) VALUES ('legacy_meta_import_status', 'copied')",
    ).run();

    // Process B arrives late, thought status was missing when it started,
    // and its outer catch now calls the atomic helper with 'failed'.
    // The guard must re-read status inside its IMMEDIATE tx and refuse.
    const wrote = importModule.__testing.atomicWriteTerminalStatus(db, 'failed');
    expect(wrote).toBe(false);

    // Terminal 'copied' survives.
    const status = (
      db.prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_status'").get() as {
        value: string;
      }
    ).value;
    expect(status).toBe('copied');
  });

  it('atomicWriteTerminalStatus: writes when status is still missing', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('race-direct-2');
    // Status is missing — guard allows the write.
    const wrote = importModule.__testing.atomicWriteTerminalStatus(db, 'failed');
    expect(wrote).toBe(true);
    expect(readStatus(db)).toBe('failed');
  });

  it('atomicWriteTerminalStatus: also writes the path key when status is copied', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('race-direct-3');
    const wrote = importModule.__testing.atomicWriteTerminalStatus(db, 'copied', '/a/legacy.db');
    expect(wrote).toBe(true);
    expect(readStatus(db)).toBe('copied');
    expect(readPath(db)).toBe('/a/legacy.db');
  });

  // End-to-end race: same scenario via the public helper — ensures the
  // outer-catch path in the real helper also respects the guard.
  it('Second helper call with already-terminal status does not clobber', () => {
    if (!Database || !importModule) return;
    const dbA = openMainDb('e2e-race');
    const legacyA = buildLegacyDb({ workspaces: [{ id: 'ws-race', name: 'Racer' }] });
    importModule.importLegacyWorkspaceMeta(dbA, legacyA, 29);
    expect(readStatus(dbA)).toBe('copied');

    // Now call the helper again with a broken legacy. Fast-path status
    // check sees terminal 'copied' and returns immediately — outer catch
    // never fires, so atomicWriteTerminalStatus isn't invoked via this
    // path. But we verify the public contract holds end-to-end: a second
    // call can't silently change a terminal state to anything else.
    const badLegacy = path.join(testDir, 'bad-e2e.db');
    fs.writeFileSync(badLegacy, Buffer.from('garbage'));
    importModule.importLegacyWorkspaceMeta(dbA, badLegacy, 29);
    // Terminal 'copied' must survive.
    expect(readStatus(dbA)).toBe('copied');
  });

  // --- Packaged-name coverage (integration-adjacent) ---
  it('works with packaged filename (workspace-meta.db, no -dev suffix)', () => {
    if (!Database || !importModule) return;
    const db = openMainDb('packaged');
    // Build a legacy file with the packaged naming convention.
    const legacy = path.join(testDir, 'workspace-meta.db');
    const legacyDb = new Database!.default(legacy);
    instances.push(legacyDb);
    legacyDb.exec(LEGACY_SCHEMA_SQL);
    legacyDb
      .prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run('ws-pkg', 'Packaged', 'now', 'now');
    legacyDb.close();

    importModule.importLegacyWorkspaceMeta(db, legacy, 29);
    expect(readStatus(db)).toBe('copied');
    expect(readPath(db)).toBe(legacy);
  });
});
