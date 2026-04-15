import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * Adds per-message fields introduced by the OpenCode SDK cutover port
 * (commercial PR #720, squash `1a320029`):
 *
 *   - `tool_status`:  'running' | 'completed' | 'error' — drives live tool-row
 *                     state transitions in the UI. The SDK adapter now emits
 *                     running-state updates that OSS previously dropped.
 *   - `model_id`:     model ID that produced the message (adapter-populated).
 *   - `provider_id`:  provider ID that produced the message (adapter-populated).
 *
 * Without these columns the UI's tool-status rendering would regress on reload
 * of historical tasks (the new TaskMessage fields would silently round-trip
 * as undefined through storage).
 *
 * Idempotent: checks column existence before altering. Safe to re-run.
 *
 * Rollback: columns are additive and never the sole source of truth. Revert by
 * landing a `v030-drop-opencode-sdk-message-fields` migration using
 * `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+).
 */

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export const migration: Migration = {
  version: 29,
  up: (db: Database) => {
    if (!hasColumn(db, 'task_messages', 'tool_status')) {
      db.exec(`ALTER TABLE task_messages ADD COLUMN tool_status TEXT`);
    }
    if (!hasColumn(db, 'task_messages', 'model_id')) {
      db.exec(`ALTER TABLE task_messages ADD COLUMN model_id TEXT`);
    }
    if (!hasColumn(db, 'task_messages', 'provider_id')) {
      db.exec(`ALTER TABLE task_messages ADD COLUMN provider_id TEXT`);
    }
    console.log('[Migrations] v029: task_messages +tool_status +model_id +provider_id');
  },
};
