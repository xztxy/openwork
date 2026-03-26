/**
 * Migration v013 — add messaging_config column to app_settings
 *
 * Stores per-platform messaging integration configuration (WhatsApp, Slack, etc.)
 * as a JSON blob. Introduced by ENG-684.
 */
import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 13,
  up: (db: Database) => {
    db.exec(`ALTER TABLE app_settings ADD COLUMN messaging_config TEXT DEFAULT NULL`);
  },
};
