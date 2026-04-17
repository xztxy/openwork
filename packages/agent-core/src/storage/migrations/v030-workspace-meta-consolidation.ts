import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * Consolidate `workspace-meta.db` into `accomplish.db`.
 *
 * WHY:
 *   The workspace metadata tables (`workspaces`, `workspace_meta`,
 *   `knowledge_notes`) historically lived in a separate SQLite file
 *   (`workspace-meta{.db,-dev.db}`) introduced by PR #748
 *   (`db8ee480 feat: workspace profiles for organizing tasks`). That file
 *   had no migration framework — any future schema drift (column add,
 *   rename, drop) would silently break existing installs. The split also
 *   caused a "forgot-to-init" bug when the daemon was split out:
 *   `getKnowledgeNotesForPrompt` threw because the daemon process never
 *   opened the second DB handle, and a swallowing try/catch in
 *   `resolveTaskConfig` turned it into silent dropped knowledge notes.
 *   PR #947 band-aided that by teaching the daemon to call
 *   `initializeMetaDatabase`; this migration retires that band-aid by
 *   folding the tables into the main DB.
 *
 * WHAT this migration does (schema only — data copy is out-of-band in
 * `importLegacyWorkspaceMeta`):
 *   1. CREATE TABLE IF NOT EXISTS the three tables with the **verbatim**
 *      column definitions from `workspace-meta-db.ts:11-37`, including
 *      the `knowledge_notes.workspace_id -> workspaces.id` FK with
 *      ON DELETE CASCADE. No column renames, type widenings, or default
 *      changes — that keeps the row-for-row copy in the import helper
 *      trivial and bug-resistant.
 *   2. Add `idx_knowledge_notes_workspace_id` — **new in v030, not
 *      present in the legacy schema**. Supports the per-workspace query
 *      pattern in `knowledgeNotes.ts` (`WHERE workspace_id = ?`) without
 *      a table scan. The legacy DB worked without the index because
 *      workspace/note counts were tiny; adding it now costs nothing on
 *      new installs and is a cheap one-time build on upgrades.
 *
 * WHAT this migration does NOT do:
 *   - It does not touch the legacy `workspace-meta.db` file on disk.
 *   - It does not copy rows from the legacy file. Both happen in
 *     `importLegacyWorkspaceMeta` and `deleteLegacyWorkspaceMetaFiles`,
 *     which run outside the migration runner's transaction (ATTACH/DETACH
 *     is not permitted inside an active transaction, and filesystem
 *     side-effects don't belong in a SQLite tx either).
 *
 * ROLLBACK:
 *   No down migration. The tables are additive; if we ever need to
 *   reverse, a future migration can DROP them (but doing so would lose
 *   the imported user data, which is why this migration deliberately
 *   has no `down`).
 */

export const migration: Migration = {
  version: 30,
  up: (db: Database) => {
    // Verbatim copy of the legacy schema (workspace-meta-db.ts:11-37).
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_notes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'context',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_notes_workspace_id
        ON knowledge_notes(workspace_id);
    `);

    console.log(
      '[Migrations] v030: workspaces + workspace_meta + knowledge_notes consolidated into main DB',
    );
  },
};
