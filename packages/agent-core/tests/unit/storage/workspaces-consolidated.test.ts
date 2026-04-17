import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Consolidated-DB CRUD test. After v030, the workspaces / workspace_meta /
 * knowledge_notes tables live in `accomplish.db` and are accessed via the
 * shared `getDatabase()` singleton. This test walks the repositories against
 * a fresh v30 DB to prove the repoint from `getMetaDatabase` → `getDatabase`
 * is functionally correct and that no deep import into `workspace-meta-db`
 * remains.
 */

type BetterSqlite3Module = typeof import('better-sqlite3');
type DbModule = typeof import('../../../src/storage/database.js');
type WorkspacesModule = typeof import('../../../src/storage/repositories/workspaces.js');
type KnowledgeNotesModule = typeof import('../../../src/storage/repositories/knowledgeNotes.js');

describe('workspaces + knowledgeNotes repositories (consolidated DB)', () => {
  let Database: BetterSqlite3Module | null = null;
  let dbModule: DbModule | null = null;
  let wsModule: WorkspacesModule | null = null;
  let knModule: KnowledgeNotesModule | null = null;
  let testDir: string;

  beforeAll(async () => {
    try {
      const m = (await import('better-sqlite3')) as BetterSqlite3Module;
      const probe = new m.default(':memory:');
      probe.close();
      Database = m;
      dbModule = await import('../../../src/storage/database.js');
      wsModule = await import('../../../src/storage/repositories/workspaces.js');
      knModule = await import('../../../src/storage/repositories/knowledgeNotes.js');
    } catch (err) {
      if (process.env.REQUIRE_SQLITE_TESTS) {
        throw new Error(
          `REQUIRE_SQLITE_TESTS set but better-sqlite3 failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      console.warn('Skipping consolidated-repo tests: better-sqlite3 native module not available');
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
      `ws-consol-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    if (dbModule) {
      const dbPath = path.join(testDir, 'main.db');
      dbModule.initializeDatabase({ databasePath: dbPath, runMigrations: true });
    }
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

  it('createDefaultWorkspace, listWorkspaces, getWorkspace round-trip', () => {
    if (!Database || !wsModule) return;
    const def = wsModule.createDefaultWorkspace();
    expect(def.isDefault).toBe(true);
    const all = wsModule.listWorkspaces();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(def.id);
    const got = wsModule.getWorkspace(def.id);
    expect(got?.name).toBe(def.name);
  });

  it('setActiveWorkspaceId / getActiveWorkspaceId via workspace_meta', () => {
    if (!Database || !wsModule) return;
    const def = wsModule.createDefaultWorkspace();
    wsModule.setActiveWorkspaceId(def.id);
    expect(wsModule.getActiveWorkspaceId()).toBe(def.id);
  });

  it('createWorkspace / updateWorkspace / deleteWorkspace CRUD', () => {
    if (!Database || !wsModule) return;
    wsModule.createDefaultWorkspace();
    const ws = wsModule.createWorkspace({ name: 'Projects', color: '#f00' });
    expect(ws.color).toBe('#f00');
    const updated = wsModule.updateWorkspace(ws.id, { description: 'All projects' });
    expect(updated?.description).toBe('All projects');
    const removed = wsModule.deleteWorkspace(ws.id);
    expect(removed).toBe(true);
    expect(wsModule.getWorkspace(ws.id)).toBeNull();
  });

  it('knowledge_notes CRUD + cascade delete when workspace removed', () => {
    if (!Database || !wsModule || !knModule) return;
    const def = wsModule.createDefaultWorkspace();
    const ws = wsModule.createWorkspace({ name: 'Temp' });
    const note = knModule.createKnowledgeNote({
      workspaceId: ws.id,
      type: 'context',
      content: 'hello',
    });
    expect(note.content).toBe('hello');
    const listed = knModule.listKnowledgeNotes(ws.id);
    expect(listed).toHaveLength(1);

    // deleteWorkspaceRecord should cascade per FK ON DELETE CASCADE.
    wsModule.deleteWorkspace(ws.id);
    const after = knModule.listKnowledgeNotes(ws.id);
    expect(after).toHaveLength(0);

    // Default workspace untouched.
    expect(wsModule.getWorkspace(def.id)).not.toBeNull();
  });

  it('no src/ file imports from workspace-meta-db', async () => {
    // Fail-fast check: if anyone re-adds a deep import to the retired file,
    // this test surfaces it. Reads source files directly; no runtime needed.
    const srcDir = path.resolve(__dirname, '../../../src');
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          // Skip the v030 migration file's intentional comment references.
          if (full.endsWith('v030-workspace-meta-consolidation.ts')) continue;
          if (
            content.includes('workspace-meta-db') ||
            content.includes('getMetaDatabase') ||
            content.includes('initializeMetaDatabase')
          ) {
            offenders.push(full);
          }
        }
      }
    }
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
