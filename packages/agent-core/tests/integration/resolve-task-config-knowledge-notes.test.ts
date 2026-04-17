import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Real-DB repository-level test for knowledge notes after the v030
 * workspace-meta consolidation. Exercises the `knowledgeNotes` repository
 * against a freshly-migrated main DB to prove the repoint from
 * `getMetaDatabase` → `getDatabase` is functionally correct and that a
 * fresh v30 install works without any `workspace-meta.db` file on disk.
 *
 * SCOPE: this test covers the repository layer only — it does NOT call
 * `resolveTaskConfig` or `generateConfig`. End-to-end coverage of the
 * prompt/runtime injection pipeline (knowledge notes → config generation
 * → `session.prompt({ system })`) lives in
 *   - `apps/daemon/__tests__/unit/task-config-builder.unit.test.ts`
 *     (config-file shape + workspaceInstructions return)
 *   - `tests/unit/internal/classes/opencode-adapter-agent-selection.unit.test.ts`
 *     (adapter-level `system` injection).
 *
 * Together those three suites prove the original PR #947 symptom
 * ("daemon-run tasks silently drop knowledge notes") cannot recur.
 *
 * Lives in agent-core (not daemon) because the daemon vitest environment
 * avoids native better-sqlite3 bindings by design.
 */

type BetterSqlite3Module = typeof import('better-sqlite3');
type DbModule = typeof import('../../src/storage/database.js');
type KnModule = typeof import('../../src/storage/repositories/knowledgeNotes.js');
type WsModule = typeof import('../../src/storage/repositories/workspaces.js');

describe('integration: resolve-task-config reads knowledge notes from the main DB', () => {
  let Database: BetterSqlite3Module | null = null;
  let dbModule: DbModule | null = null;
  let knModule: KnModule | null = null;
  let wsModule: WsModule | null = null;
  let testDir: string;

  beforeAll(async () => {
    try {
      const m = (await import('better-sqlite3')) as BetterSqlite3Module;
      const probe = new m.default(':memory:');
      probe.close();
      Database = m;
      dbModule = await import('../../src/storage/database.js');
      knModule = await import('../../src/storage/repositories/knowledgeNotes.js');
      wsModule = await import('../../src/storage/repositories/workspaces.js');
    } catch (err) {
      if (process.env.REQUIRE_SQLITE_TESTS) {
        throw new Error(
          `REQUIRE_SQLITE_TESTS set but better-sqlite3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      console.warn(
        'Skipping resolve-task-config integration test: better-sqlite3 native module not available',
      );
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
    testDir = path.join(os.tmpdir(), `rtc-kn-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('getKnowledgeNotesForPrompt returns formatted text for a seeded workspace', () => {
    if (!Database || !dbModule || !knModule || !wsModule) return;

    const dbPath = path.join(testDir, 'main.db');
    dbModule.initializeDatabase({ databasePath: dbPath, runMigrations: true });

    // Seed via the real repositories (not raw SQL) — proves the whole stack
    // from repo → getDatabase → main DB round-trips.
    const ws = wsModule.createWorkspace({ name: 'Test' });
    knModule.createKnowledgeNote({
      workspaceId: ws.id,
      type: 'context',
      content: 'Project uses PostgreSQL 16',
    });
    knModule.createKnowledgeNote({
      workspaceId: ws.id,
      type: 'instruction',
      content: 'Always 2-space YAML indent',
    });

    const formatted = knModule.getKnowledgeNotesForPrompt(ws.id);
    expect(formatted).toBeTruthy();
    // Formatter groups by type; spot-check both note contents are in output.
    expect(formatted).toContain('Project uses PostgreSQL 16');
    expect(formatted).toContain('Always 2-space YAML indent');
  });

  it('getKnowledgeNotesForPrompt returns empty string when workspace has no notes', () => {
    if (!Database || !dbModule || !knModule || !wsModule) return;

    const dbPath = path.join(testDir, 'main.db');
    dbModule.initializeDatabase({ databasePath: dbPath, runMigrations: true });

    const ws = wsModule.createWorkspace({ name: 'Empty' });
    const formatted = knModule.getKnowledgeNotesForPrompt(ws.id);
    expect(formatted).toBe('');
  });

  it('does not throw when called against a fresh v30 DB (no workspace-meta.db on disk)', () => {
    if (!Database || !dbModule || !knModule) return;

    // No legacy file, no `workspace-meta.db` anywhere. The repository should
    // read from the main DB via `getDatabase()` and return cleanly.
    const dbPath = path.join(testDir, 'main.db');
    dbModule.initializeDatabase({ databasePath: dbPath, runMigrations: true });

    expect(() => knModule!.getKnowledgeNotesForPrompt('no-such-workspace')).not.toThrow();
  });
});
