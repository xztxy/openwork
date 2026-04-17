import fs from 'fs';
import { getDatabase } from './database.js';
import { createConsoleLogger } from '../utils/logging.js';

const log = createConsoleLogger({ prefix: 'legacy-meta-delete' });

/**
 * Delete the legacy `workspace-meta{.db,-dev.db}` triplet from disk AFTER
 * a verified successful import (`legacy_meta_import_status = 'copied'`) and
 * only when the path matches what was imported.
 *
 * SEQUENCING CONTRACT: this helper MUST be called AFTER `storage.initialize()`
 * (which runs migrations, then `importLegacyWorkspaceMeta`). It resolves the
 * main DB handle internally via `getDatabase()` — a synchronous call that
 * throws `Database not initialized` if the caller got the order wrong. That's
 * louder than a silent no-op, which is what we want: downstream wiring bugs
 * should surface immediately rather than leave legacy files in place.
 *
 * Gated on:
 *   - `schema_meta.legacy_meta_import_status === 'copied'`
 *   - `schema_meta.legacy_meta_import_path === metaDbPath` (byte-exact)
 *
 * Any other status ('none' / 'failed' / 'conflict' / missing) → no-op and
 * preserve the legacy file for manual recovery. A path mismatch is a loud
 * error but NOT a throw — we refuse to delete and log which paths disagreed.
 *
 * Deletion failures on individual siblings are logged and ignored: the main
 * DB already has the data, so leftover files are harmless and the helper
 * will retry next boot.
 */
export function deleteLegacyWorkspaceMetaFiles(metaDbPath: string): void {
  const db = getDatabase();

  const statusRow = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_status'")
    .get() as { value: string } | undefined;
  const status = statusRow?.value;

  // Only 'copied' proceeds; everything else preserves the legacy file.
  if (status !== 'copied') return;

  const storedPathRow = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_path'")
    .get() as { value: string } | undefined;
  const storedPath = storedPathRow?.value;

  if (!storedPath) {
    // Should not happen: import writes status + path atomically. Defensive.
    log.error(
      `Refusing to delete: status='copied' but legacy_meta_import_path is missing. ` +
        `Not deleting ${metaDbPath}.`,
    );
    return;
  }

  if (storedPath !== metaDbPath) {
    log.error(
      `Refusing to delete: stored import path (${storedPath}) does not match ` +
        `caller's path (${metaDbPath}). Not deleting.`,
    );
    return;
  }

  // Passed all gates — delete the triplet. Each sibling is best-effort;
  // ENOENT is ignored per sibling, other errors logged but non-fatal.
  let deleted = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    const p = metaDbPath + suffix;
    try {
      fs.unlinkSync(p);
      deleted += 1;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        log.warn(`Failed to delete ${p}: ${(err as Error).message}`);
      }
    }
  }
  if (deleted > 0) {
    log.info(`Deleted ${deleted} legacy workspace-meta file(s) at ${metaDbPath}`);
  }
}
