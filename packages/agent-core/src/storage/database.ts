import Database from 'better-sqlite3';
import fs from 'fs';
import { runMigrations, getStoredVersion, CURRENT_VERSION } from './migrations/index.js';
import { FutureSchemaError } from './migrations/errors.js';
import { importLegacyWorkspaceMeta } from './import-legacy-workspace-meta.js';
import { createConsoleLogger } from '../utils/logging.js';

const log = createConsoleLogger({ prefix: 'DB' });

export interface DatabaseOptions {
  databasePath: string;
  runMigrations?: boolean;
  /**
   * Path to the legacy `workspace-meta{.db,-dev.db}` SQLite file. When the
   * main DB reaches v30 via migrations, `importLegacyWorkspaceMeta` copies
   * workspaces / workspace_meta / knowledge_notes rows from this file into
   * the main DB. Terminal status in `schema_meta.legacy_meta_import_status`
   * makes the import a one-shot; the companion path key
   * `legacy_meta_import_path` pins deletion to the exact imported path.
   *
   * Omit for callers that don't open the SQLite DB (e.g. secure-storage-only
   * wrappers) or for test fixtures that want empty-install behavior.
   */
  legacyMetaDbPath?: string;
}

let _db: Database.Database | null = null;
let _currentPath: string | null = null;

export function getDatabase(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return _db;
}

export function initializeDatabase(options: DatabaseOptions): Database.Database {
  const { databasePath, runMigrations: shouldRunMigrations = true, legacyMetaDbPath } = options;

  const isReopen = _db !== null && _currentPath === databasePath;

  // Capture pre-migration version BEFORE running migrations. Used by the
  // import helper to distinguish the v30 upgrade boot (preMigrationVersion
  // < 30, legitimate time to record terminal `'none'` for empty-legacy
  // cases) from post-consolidation boots (preMigrationVersion >= 30, silent
  // no-op when the legacy file is absent). On reopens, no migration runs —
  // use CURRENT_VERSION so the import helper doesn't think this is an
  // upgrade boot.
  let preMigrationVersion = CURRENT_VERSION;

  if (!isReopen) {
    if (_db) {
      closeDatabase();
    }

    log.info(`[DB] Opening database at: ${databasePath}`);

    _db = new Database(databasePath);
    _currentPath = databasePath;

    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    if (shouldRunMigrations) {
      preMigrationVersion = getStoredVersion(_db);
      if (preMigrationVersion > CURRENT_VERSION) {
        const error = new FutureSchemaError(preMigrationVersion, CURRENT_VERSION);
        closeDatabase();
        throw error;
      }

      runMigrations(_db);
      log.info('[DB] Database initialized and migrations complete');
    }
  }

  // Run the import helper on every call where migrations are enabled and a
  // legacy path was provided. Terminal status makes it a no-op after the
  // first successful / failed / conflicting attempt; only ran here so that
  // a same-process reopen that newly supplies `legacyMetaDbPath` still
  // reaches the helper. `shouldRunMigrations=false` callers bypass import
  // entirely — the v30 tables may not exist and running import would blow
  // up.
  if (shouldRunMigrations && legacyMetaDbPath && _db) {
    importLegacyWorkspaceMeta(_db, legacyMetaDbPath, preMigrationVersion);
  }

  return _db!;
}

export function closeDatabase(): void {
  if (_db) {
    log.info('[DB] Closing database connection');
    _db.close();
    _db = null;
    _currentPath = null;
  }
}

export function resetDatabaseInstance(): void {
  closeDatabase();
}

export function isDatabaseInitialized(): boolean {
  return _db !== null;
}

export function getDatabasePath(): string | null {
  return _currentPath;
}

export function resetDatabase(databasePath: string): void {
  closeDatabase();

  if (fs.existsSync(databasePath)) {
    const backupPath = `${databasePath}.corrupt.${Date.now()}`;
    log.info(`[DB] Backing up corrupt database to: ${backupPath}`);
    fs.renameSync(databasePath, backupPath);
  }

  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}

export function databaseExists(databasePath: string): boolean {
  return fs.existsSync(databasePath);
}
