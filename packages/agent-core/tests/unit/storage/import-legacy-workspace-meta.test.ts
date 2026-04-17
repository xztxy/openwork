import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
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
    } catch {
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
});
