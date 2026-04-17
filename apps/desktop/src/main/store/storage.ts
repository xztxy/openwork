import { app } from 'electron';
import path from 'path';
import {
  createStorage,
  deleteLegacyWorkspaceMetaFiles,
  type StorageAPI,
} from '@accomplish_ai/agent-core';
// Deep import for legacy migration only — getDatabase is intentionally not part of StorageAPI
import { getDatabase as coreGetDatabase } from '@accomplish_ai/agent-core/storage/database';
import type { Database } from 'better-sqlite3';
import { importLegacyElectronStoreData } from './electronStoreImport';

let _storage: StorageAPI | null = null;

export function getDatabasePath(): string {
  const dbName = app.isPackaged ? 'accomplish.db' : 'accomplish-dev.db';
  return path.join(app.getPath('userData'), dbName);
}

/**
 * Pure helper — reads stable inputs (`app.isPackaged`, `app.getPath('userData')`)
 * and returns byte-identical strings on every invocation. Called by both
 * `getStorage()` (passes into `createStorage`) and `initializeStorage()` (passes
 * into `deleteLegacyWorkspaceMetaFiles`). This is the single source of truth for
 * the legacy path so import and delete can't disagree on what to touch.
 */
export function getLegacyMetaDbPath(): string {
  const fileName = app.isPackaged ? 'workspace-meta.db' : 'workspace-meta-dev.db';
  return path.join(app.getPath('userData'), fileName);
}

export function getStorage(): StorageAPI {
  if (!_storage) {
    _storage = createStorage({
      databasePath: getDatabasePath(),
      runMigrations: true,
      userDataPath: app.getPath('userData'),
      secureStorageFileName: app.isPackaged ? 'secure-storage.json' : 'secure-storage-dev.json',
      legacyMetaDbPath: getLegacyMetaDbPath(),
    });
  }
  return _storage;
}

/**
 * Initialize both the database and secure storage.
 * On first run, also imports data from the legacy electron-store format and
 * deletes the retired `workspace-meta{.db,-dev.db}` triplet if v030 import
 * succeeded. Deletion is a no-op unless `legacy_meta_import_status='copied'`
 * was written by `importLegacyWorkspaceMeta` during `storage.initialize()`.
 */
export function initializeStorage(): void {
  const storage = getStorage();
  if (!storage.isDatabaseInitialized()) {
    storage.initialize();

    // One-time legacy data import from old electron-store format
    const db: Database = coreGetDatabase();
    importLegacyElectronStoreData(db);

    // After `storage.initialize()` has run migrations + the in-db import
    // helper, clean up the retired legacy workspace-meta file on disk.
    // Runs on every boot; terminal status in schema_meta makes it a no-op
    // after the first successful import (or a no-op for non-'copied' states).
    deleteLegacyWorkspaceMetaFiles(getLegacyMetaDbPath());
  }
}

export function closeStorage(): void {
  if (_storage) {
    _storage.close();
    _storage = null;
  }
}

/**
 * Reset the storage singleton after CLEAN_START deletes the userData directory.
 * Closes the open database handle before nulling the reference.
 */
export function resetStorageSingleton(): void {
  if (_storage) {
    _storage.close();
    _storage = null;
  }
}
