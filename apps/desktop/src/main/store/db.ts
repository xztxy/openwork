// ---------------------------------------------------------------------------
// Backward-compatible re-exports from the unified storage module.
// New code should import from './storage' directly.
// ---------------------------------------------------------------------------

import fs from 'fs';
import { getDatabase as coreGetDatabase } from '@accomplish_ai/agent-core/storage/database';
import {
  getDatabasePath,
  initializeStorage,
  closeStorage,
  resetStorage,
} from './storage';

export { getDatabasePath };

export function getDatabase() {
  return coreGetDatabase();
}

export function initializeDatabase(): void {
  initializeStorage();
}

export function closeDatabase(): void {
  closeStorage();
}

export function resetDatabase(): void {
  resetStorage();
}

export function databaseExists(): boolean {
  return fs.existsSync(getDatabasePath());
}
