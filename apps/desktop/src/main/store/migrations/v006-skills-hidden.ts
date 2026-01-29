// apps/desktop/src/main/store/migrations/v006-skills-hidden.ts

import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

export const migration: Migration = {
  version: 6,
  up(db: Database): void {
    // Add is_hidden column to skills table
    db.exec(`ALTER TABLE skills ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`);
    console.log('[v006] Added is_hidden column to skills table');
  },
};
