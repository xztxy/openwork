import type { Database } from "better-sqlite3";
import type { Migration } from "./index.js";

export const migration: Migration = {
  version: 11,
  up: (db: Database) => {
    // Add workspace_id column to tasks table (for workspace profiles feature)
    // Check if column already exists before adding to handle partial migrations
    const tableInfo = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const hasWorkspaceId = tableInfo.some((col) => col.name === 'workspace_id');
    if (!hasWorkspaceId) {
      db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT`);
      // Index for filtering tasks by workspace
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`);
    }
  },
};
