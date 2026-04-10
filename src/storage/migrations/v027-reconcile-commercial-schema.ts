import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * Reconciliation migration for users upgrading from the commercial Free app
 * to the OSS-built Free app.
 *
 * The commercial repo had a different migration history: v001 (full schema)
 * jumped directly to v023, skipping OSS migrations v002-v022. This means
 * columns added by those OSS migrations (workspace_id, nim_config, etc.)
 * are missing from commercial-origin databases even though the version
 * number is >= 23.
 *
 * This migration idempotently adds all potentially missing columns and tables.
 * Safe to run on any database — checks existence before altering.
 */

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function hasTable(db: Database, table: string): boolean {
  const result = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return !!result;
}

export const migration: Migration = {
  version: 27,
  up: (db: Database) => {
    // ─── app_settings columns (v002, v003, v010, v012, v013, v014, v016, v017, v020, v022) ───

    // v002
    if (!hasColumn(db, 'app_settings', 'azure_foundry_config')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN azure_foundry_config TEXT`);
    }
    // v003
    if (!hasColumn(db, 'app_settings', 'lmstudio_config')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN lmstudio_config TEXT`);
    }
    // v010
    if (!hasColumn(db, 'app_settings', 'sandbox_config')) {
      db.exec(
        `ALTER TABLE app_settings ADD COLUMN sandbox_config TEXT NOT NULL DEFAULT '${JSON.stringify({ enabled: false })}'`,
      );
    }
    // v012
    if (!hasColumn(db, 'app_settings', 'cloud_browser_config')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN cloud_browser_config TEXT DEFAULT NULL`);
    }
    // v013
    if (!hasColumn(db, 'app_settings', 'run_in_background')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN run_in_background INTEGER NOT NULL DEFAULT 0`);
    }
    // v014
    if (!hasColumn(db, 'app_settings', 'desktop_blocklist')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN desktop_blocklist TEXT DEFAULT NULL`);
    }
    // v016
    if (!hasColumn(db, 'app_settings', 'notifications_enabled')) {
      db.exec(
        `ALTER TABLE app_settings ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1`,
      );
    }
    // v017
    if (!hasColumn(db, 'app_settings', 'nim_config')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN nim_config TEXT`);
    }
    // v020
    if (!hasColumn(db, 'app_settings', 'messaging_config')) {
      db.exec(`ALTER TABLE app_settings ADD COLUMN messaging_config TEXT DEFAULT NULL`);
    }
    // v022 (run_in_background already handled above by v013 check)

    // ─── providers table column (v015) ─────────────────────────────────────────

    if (hasTable(db, 'providers') && !hasColumn(db, 'providers', 'custom_base_url')) {
      db.exec(`ALTER TABLE providers ADD COLUMN custom_base_url TEXT DEFAULT NULL`);
    }

    // ─── tasks columns (v011) ──────────────────────────────────────────────────

    if (!hasColumn(db, 'tasks', 'workspace_id')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`);
    }

    // ─── tables (v005, v009) ───────────────────────────────────────────────────

    // v005: task_todos
    if (!hasTable(db, 'task_todos')) {
      db.exec(`
        CREATE TABLE task_todos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          content TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_todos_task_id ON task_todos(task_id)`);
    }

    // v009: task_favorites — must match OSS schema (not commercial schema)
    // OSS uses: task_id PK, prompt, summary, favorited_at
    // If table exists with wrong schema (from commercial or earlier v027), recreate it
    if (hasTable(db, 'task_favorites')) {
      const cols = db.prepare('PRAGMA table_info(task_favorites)').all() as Array<{ name: string }>;
      const hasPrompt = cols.some((c) => c.name === 'prompt');
      if (!hasPrompt) {
        // Wrong schema — drop and recreate with correct OSS schema
        db.exec('DROP TABLE task_favorites');
        db.exec(`
          CREATE TABLE task_favorites (
            task_id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            summary TEXT,
            favorited_at TEXT NOT NULL
          )
        `);
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_task_favorites_favorited_at ON task_favorites(favorited_at)',
        );
      }
    } else {
      db.exec(`
        CREATE TABLE task_favorites (
          task_id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          summary TEXT,
          favorited_at TEXT NOT NULL
        )
      `);
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_task_favorites_favorited_at ON task_favorites(favorited_at)',
      );
    }

    // v023 scheduled_tasks, v025 accomplish_ai_credits — these are from OSS v023+
    // which should run on commercial DBs (version 23). But check for safety:
    if (!hasTable(db, 'scheduled_tasks')) {
      db.exec(`
        CREATE TABLE scheduled_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          prompt TEXT NOT NULL,
          cron TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          next_run_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }

    if (!hasTable(db, 'accomplish_ai_credits')) {
      db.exec(`
        CREATE TABLE accomplish_ai_credits (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          spent_credits REAL NOT NULL DEFAULT 0,
          remaining_credits REAL NOT NULL DEFAULT 0,
          total_credits REAL NOT NULL DEFAULT 0,
          resets_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }

    console.log('[Migrations] v027: Commercial → OSS schema reconciliation complete');
  },
};
