// apps/desktop/src/main/store/migrations/v002-azure-foundry.ts

import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

/**
 * Migration v002: Add Azure Foundry configuration column
 */
export const migration: Migration = {
  version: 2,
  up(db: Database): void {
    db.exec(`
      ALTER TABLE app_settings
      ADD COLUMN azure_foundry_config TEXT
    `);
    console.log('[v002] Added azure_foundry_config column');
  },
};
