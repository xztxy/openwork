import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createStorage, type StorageAPI } from '@accomplish_ai/agent-core';

const DEV_DEFAULT_DATA_DIR = join(homedir(), '.accomplish');

export class StorageService {
  private storage: StorageAPI | null = null;

  /**
   * Initialize storage.
   *
   * @param dataDir — Data directory. Required in production (passed via --data-dir).
   *                   In dev mode (no --data-dir), falls back to `~/.accomplish`.
   */
  initialize(dataDir?: string): StorageAPI {
    const dir = dataDir || DEV_DEFAULT_DATA_DIR;
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Use the same database name as the desktop app when --data-dir is
    // explicitly provided (shared DB). In standalone dev mode, use the
    // dev database name to avoid conflicts with the packaged app.
    const dbName = dataDir ? 'accomplish.db' : 'accomplish-dev.db';
    const databasePath = join(dir, dbName);

    this.storage = createStorage({
      databasePath,
      runMigrations: true,
      userDataPath: dir,
      secureStorageFileName: dataDir ? 'secure-storage.json' : 'secure-storage-dev.json',
    });

    this.storage.initialize();
    console.log(`[StorageService] Database initialized at ${databasePath}`);
    return this.storage;
  }

  getStorage(): StorageAPI {
    if (!this.storage) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this.storage;
  }

  close(): void {
    if (this.storage) {
      this.storage.close();
      this.storage = null;
      console.log('[StorageService] Database closed');
    }
  }
}
