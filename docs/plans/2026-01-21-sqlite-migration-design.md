# SQLite Storage Migration Design

## Overview

Migrate from electron-store JSON files to SQLite for app-settings, provider-settings, and task-history. Enables schema migrations, rollback protection, and future-proofing.

## Decisions

| Aspect | Decision |
|--------|----------|
| Storage | SQLite with better-sqlite3 |
| Stores migrated | app-settings, provider-settings, task-history |
| Stores unchanged | secure-storage (encrypted JSON) |
| Versioning | Unified schema version for all stores |
| Rollback handling | Block startup if schema > app version |
| Migration complexity | Moderate (renames, defaults, restructuring) |

## Database Schema

Single SQLite file: `{userData}/openwork.db` (or `openwork-dev.db` in dev).

```sql
-- Schema version tracking
CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- App settings (single row, typed columns)
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  debug_mode INTEGER NOT NULL DEFAULT 0,
  onboarding_complete INTEGER NOT NULL DEFAULT 0,
  selected_model TEXT,       -- JSON: { provider, model, baseUrl? }
  ollama_config TEXT,        -- JSON: { baseUrl, enabled, ... }
  litellm_config TEXT        -- JSON: { baseUrl, enabled, ... }
);

-- Provider settings
CREATE TABLE provider_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_provider_id TEXT,
  debug_mode INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE providers (
  provider_id TEXT PRIMARY KEY,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  selected_model_id TEXT,
  credentials_type TEXT NOT NULL,
  credentials_data TEXT,     -- JSON (non-sensitive)
  last_connected_at TEXT,
  available_models TEXT      -- JSON array
);

-- Task history
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE task_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  timestamp TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES task_messages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  label TEXT
);

CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX idx_messages_task_id ON task_messages(task_id);
```

## Migration System

### File Structure

```
src/main/store/
  db.ts              # Database initialization + connection
  migrations/
    index.ts         # Migration runner
    errors.ts        # FutureSchemaError, MigrationError, CorruptDatabaseError
    v001-initial.ts  # Creates schema + imports legacy JSON data
  repositories/
    appSettings.ts   # App settings queries
    providers.ts     # Provider settings queries
    taskHistory.ts   # Task history queries
```

### Migration File Format

```typescript
// v001-initial.ts
import type { Database } from 'better-sqlite3';

export const version = 1;

export function up(db: Database): void {
  db.exec(`CREATE TABLE app_settings (...)`);
  // ... create all tables

  // Insert default rows for single-row tables
  db.exec(`INSERT INTO app_settings (id) VALUES (1)`);
  db.exec(`INSERT INTO provider_meta (id) VALUES (1)`);

  // Import from legacy JSON stores
  importAppSettings(db);
  importProviderSettings(db);
  importTaskHistory(db);

  // Rename old files
  cleanupLegacyStores();
}
```

### Migration Runner

```typescript
const CURRENT_VERSION = 1;

export function runMigrations(db: Database): void {
  const storedVersion = getStoredVersion(db);  // 0 if fresh

  // Block if DB is from a newer app version
  if (storedVersion > CURRENT_VERSION) {
    throw new FutureSchemaError(storedVersion, CURRENT_VERSION);
  }

  // Run pending migrations in transaction
  for (let v = storedVersion + 1; v <= CURRENT_VERSION; v++) {
    const migration = migrations[v];
    db.transaction(() => {
      migration.up(db);
      setStoredVersion(db, v);
    })();
  }
}
```

## Database Access Layer

### Initialization (db.ts)

```typescript
import Database from 'better-sqlite3';
import { app } from 'electron';
import { runMigrations } from './migrations';

let _db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!_db) {
    const dbName = app.isPackaged ? 'openwork.db' : 'openwork-dev.db';
    const dbPath = path.join(app.getPath('userData'), dbName);

    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    runMigrations(_db);
  }
  return _db;
}

export function closeDatabase(): void {
  _db?.close();
  _db = null;
}
```

### Repository Pattern

```typescript
// repositories/appSettings.ts
import { getDatabase } from '../db';

export function getDebugMode(): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT debug_mode FROM app_settings WHERE id = 1').get();
  return row?.debug_mode === 1;
}

export function setDebugMode(enabled: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET debug_mode = ? WHERE id = 1').run(enabled ? 1 : 0);
}
```

Same functional API as current stores—no changes needed in IPC handlers.

## Startup Flow

```typescript
// src/main/index.ts
import { getDatabase, closeDatabase } from './store/db';
import { FutureSchemaError } from './store/migrations';

app.whenReady().then(async () => {
  try {
    getDatabase();
  } catch (err) {
    if (err instanceof FutureSchemaError) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Required',
        message: `This data was created by a newer version of Openwork (schema v${err.storedVersion}).`,
        detail: `Your app supports up to schema v${err.appVersion}. Please update Openwork to continue.`,
        buttons: ['Quit'],
      });
      app.quit();
      return;
    }
    throw err;
  }

  createWindow();
});

app.on('before-quit', () => {
  closeDatabase();
});
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Fresh install | Create DB, run all migrations from v0 |
| Normal update | Run pending migrations sequentially |
| Future schema | Block startup with update dialog |
| Migration fails | Rollback transaction, show error dialog |
| Corrupt DB file | Offer to reset (backup old file, create fresh) |

### Error Classes

```typescript
export class FutureSchemaError extends Error {
  constructor(public storedVersion: number, public appVersion: number) {
    super(`Schema v${storedVersion} is newer than supported v${appVersion}`);
  }
}

export class MigrationError extends Error {
  constructor(public version: number, public cause: Error) {
    super(`Migration to v${version} failed: ${cause.message}`);
  }
}

export class CorruptDatabaseError extends Error {
  constructor(message: string) {
    super(`Database corrupted: ${message}`);
  }
}
```

### Recovery

```typescript
export function resetDatabase(): void {
  const dbPath = getDatabasePath();
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    fs.renameSync(dbPath, backupPath);
  }
  _db = null;
}
```

## Legacy Data Migration

v001 migration imports from existing JSON stores:

```typescript
function importAppSettings(db: Database): void {
  const legacy = new Store({ name: getStoreName('app-settings') });
  if (!legacy.size) return;

  db.prepare(`
    UPDATE app_settings SET
      debug_mode = ?,
      onboarding_complete = ?,
      selected_model = ?,
      ollama_config = ?,
      litellm_config = ?
    WHERE id = 1
  `).run(
    legacy.get('debugMode') ? 1 : 0,
    legacy.get('onboardingComplete') ? 1 : 0,
    JSON.stringify(legacy.get('selectedModel')),
    JSON.stringify(legacy.get('ollamaConfig')),
    JSON.stringify(legacy.get('litellmConfig'))
  );
}
```

After import, rename old files:

```typescript
function cleanupLegacyStores(): void {
  const storeNames = ['app-settings', 'provider-settings', 'task-history'];
  const suffix = app.isPackaged ? '' : '-dev';

  for (const name of storeNames) {
    const legacyPath = path.join(app.getPath('userData'), `${name}${suffix}.json`);
    if (fs.existsSync(legacyPath)) {
      fs.renameSync(legacyPath, `${legacyPath}.migrated`);
    }
  }
}
```

## Build Configuration

**Dependencies:**

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

Native module rebuild handled by existing electron-rebuild setup (same as node-pty).

## File Structure After Migration

```
~/Library/Application Support/Openwork/
├── openwork.db                    # New SQLite database
├── openwork.db-wal                # WAL file (auto-managed)
├── openwork.db-shm                # Shared memory (auto-managed)
├── app-settings.json.migrated     # Backup of old data
├── provider-settings.json.migrated
├── task-history.json.migrated
└── secure-storage.json            # Unchanged
```

## Files to Create/Modify

```
apps/desktop/
├── package.json                      # Add better-sqlite3
├── src/main/
│   ├── index.ts                      # Database init on startup
│   └── store/
│       ├── db.ts                     # NEW
│       ├── migrations/
│       │   ├── index.ts              # NEW
│       │   ├── errors.ts             # NEW
│       │   └── v001-initial.ts       # NEW
│       └── repositories/
│           ├── appSettings.ts        # REPLACE
│           ├── providers.ts          # REPLACE
│           └── taskHistory.ts        # REPLACE
```
