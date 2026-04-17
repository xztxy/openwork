import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Migration v030: workspaces / workspace_meta / knowledge_notes consolidation.
 *
 * Skipped gracefully if better-sqlite3 native bindings aren't available.
 */

type BetterSqlite3Module = typeof import('better-sqlite3');
type MigrationModule =
  typeof import('../../../../src/storage/migrations/v030-workspace-meta-consolidation.js');

describe('migration v030: workspace-meta consolidation', () => {
  let testDir: string;
  let Database: BetterSqlite3Module | null = null;
  let migrationModule: MigrationModule | null = null;
  let dbInstances: InstanceType<Awaited<BetterSqlite3Module>['default']>[] = [];

  beforeAll(async () => {
    try {
      const BetterSqlite3 = (await import('better-sqlite3')) as BetterSqlite3Module;
      const tmpDb = new BetterSqlite3.default(':memory:');
      tmpDb.close();
      Database = BetterSqlite3;
      migrationModule =
        await import('../../../../src/storage/migrations/v030-workspace-meta-consolidation.js');
    } catch (err) {
      if (process.env.REQUIRE_SQLITE_TESTS) {
        throw new Error(
          `REQUIRE_SQLITE_TESTS set but better-sqlite3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      console.warn('Skipping v030 migration tests: better-sqlite3 native module not available');
    }

    testDir = path.join(
      os.tmpdir(),
      `v030-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    for (const db of dbInstances) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    dbInstances = [];
  });

  function openDb(name: string) {
    if (!Database) {
      throw new Error('better-sqlite3 not available');
    }
    const dbPath = path.join(testDir, `${name}-${Date.now()}.db`);
    const db = new Database.default(dbPath);
    dbInstances.push(db);
    return db;
  }

  it('creates workspaces, workspace_meta, knowledge_notes tables', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('create');
    migrationModule.migration.up(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain('workspaces');
    expect(names).toContain('workspace_meta');
    expect(names).toContain('knowledge_notes');
  });

  it('workspaces has the expected columns and constraints', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('cols-workspaces');
    migrationModule.migration.up(db);

    const columns = db.prepare('PRAGMA table_info(workspaces)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: string | null;
    }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual([
      'id',
      'name',
      'description',
      'color',
      'sort_order',
      'is_default',
      'created_at',
      'updated_at',
    ]);

    // Primary key
    expect(columns.find((c) => c.name === 'id')?.pk).toBe(1);
    // NOT NULL on name / sort_order / is_default / created_at / updated_at
    expect(columns.find((c) => c.name === 'name')?.notnull).toBe(1);
    expect(columns.find((c) => c.name === 'sort_order')?.notnull).toBe(1);
    expect(columns.find((c) => c.name === 'is_default')?.notnull).toBe(1);
    // UNIQUE(name)
    const indexes = db.prepare('PRAGMA index_list(workspaces)').all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(indexes.some((i) => i.unique === 1)).toBe(true);
  });

  it('workspace_meta has the expected columns', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('cols-meta');
    migrationModule.migration.up(db);

    const columns = db.prepare('PRAGMA table_info(workspace_meta)').all() as Array<{
      name: string;
      pk: number;
    }>;
    expect(columns.map((c) => c.name)).toEqual(['key', 'value']);
    expect(columns.find((c) => c.name === 'key')?.pk).toBe(1);
  });

  it('knowledge_notes has the expected columns and FK', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('cols-notes');
    migrationModule.migration.up(db);

    const columns = db.prepare('PRAGMA table_info(knowledge_notes)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((c) => c.name)).toEqual([
      'id',
      'workspace_id',
      'type',
      'content',
      'created_at',
      'updated_at',
    ]);

    const fks = db.prepare('PRAGMA foreign_key_list(knowledge_notes)').all() as Array<{
      from: string;
      to: string;
      table: string;
      on_delete: string;
    }>;
    const fk = fks.find((f) => f.from === 'workspace_id');
    expect(fk).toBeDefined();
    expect(fk?.to).toBe('id');
    expect(fk?.table).toBe('workspaces');
    expect(fk?.on_delete).toBe('CASCADE');
  });

  it('creates idx_knowledge_notes_workspace_id index (new in v030)', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('index');
    migrationModule.migration.up(db);

    const indexes = db.prepare('PRAGMA index_list(knowledge_notes)').all() as Array<{
      name: string;
    }>;
    expect(indexes.some((i) => i.name === 'idx_knowledge_notes_workspace_id')).toBe(true);
  });

  it('is idempotent — running up() twice does not throw', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('idempotent');
    migrationModule.migration.up(db);
    expect(() => migrationModule!.migration.up(db)).not.toThrow();
  });

  it('enforces knowledge_notes FK when foreign_keys=ON', () => {
    if (!Database || !migrationModule) return;

    const db = openDb('fk');
    db.pragma('foreign_keys = ON');
    migrationModule.migration.up(db);

    // Inserting a knowledge_note with a workspace_id that doesn't exist
    // should throw under FK enforcement.
    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge_notes (id, workspace_id, type, content, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('kn-1', 'ws-nonexistent', 'context', 'hello', 'now', 'now'),
    ).toThrow();
  });

  it('migration version is 30', () => {
    if (!migrationModule) return;
    expect(migrationModule.migration.version).toBe(30);
  });
});
