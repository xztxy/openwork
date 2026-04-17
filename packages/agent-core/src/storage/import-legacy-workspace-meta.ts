import Database from 'better-sqlite3';
import fs from 'fs';
import { createConsoleLogger } from '../utils/logging.js';

const log = createConsoleLogger({ prefix: 'legacy-meta' });

/**
 * Copy workspace / workspace_meta / knowledge_notes rows out of the legacy
 * `workspace-meta{.db,-dev.db}` file and into the main `accomplish.db`.
 *
 * Runs OUTSIDE the migration runner (ATTACH/DETACH is not allowed inside an
 * active SQLite transaction, and the migration runner wraps every `up()` in
 * one). Called from `initializeDatabase` after `runMigrations` returns.
 *
 * Decision state is recorded via two atomic `schema_meta` keys written
 * together on success:
 *
 *   - `legacy_meta_import_status`  ∈ { 'none', 'copied', 'conflict', 'failed' }
 *                                  All non-missing values are TERMINAL;
 *                                  manual recovery is required to re-attempt.
 *   - `legacy_meta_import_path`    The exact `legacyMetaDbPath` string that
 *                                  was imported. `deleteLegacyWorkspaceMetaFiles`
 *                                  refuses to delete unless this byte-matches
 *                                  the path it is handed.
 *
 * Manual recovery from `failed` / `conflict` (support-desk workflow):
 *
 *   PRAGMA foreign_keys = ON;
 *   DELETE FROM knowledge_notes;
 *   DELETE FROM workspace_meta;
 *   DELETE FROM workspaces;
 *   DELETE FROM schema_meta
 *     WHERE key IN ('legacy_meta_import_status', 'legacy_meta_import_path');
 *
 * Restore the legacy file and restart. Next boot will re-attempt with
 * empty destination tables.
 */

export type ImportStatus = 'none' | 'copied' | 'conflict' | 'failed';

type FileState = { kind: 'missing' } | { kind: 'present'; size: number } | { kind: 'unknown' };

function readStatus(mainDb: Database.Database): ImportStatus | undefined {
  try {
    const row = mainDb
      .prepare("SELECT value FROM schema_meta WHERE key = 'legacy_meta_import_status'")
      .get() as { value: string } | undefined;
    return row?.value as ImportStatus | undefined;
  } catch {
    // schema_meta may not exist if migrations were skipped.
    return undefined;
  }
}

function writeStatus(mainDb: Database.Database, status: ImportStatus): void {
  mainDb
    .prepare(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('legacy_meta_import_status', ?)",
    )
    .run(status);
}

function writeImportPath(mainDb: Database.Database, path: string): void {
  mainDb
    .prepare(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('legacy_meta_import_path', ?)",
    )
    .run(path);
}

/**
 * Read a file's state without propagating errors. Distinguishes:
 *   - 'missing' — file truly not there (ENOENT/ENOTDIR)
 *   - 'present' — got stat; `size` is reliable
 *   - 'unknown' — stat failed for other reasons (EACCES, race, bad link)
 *
 * `unknown` is NEVER collapsed into `missing`. Callers treat it as
 * non-empty and fall through to the import path so we don't accidentally
 * write `status='none'` over an inaccessible-but-recoverable legacy DB.
 */
function safeFileState(p: string): FileState {
  try {
    const st = fs.statSync(p);
    return { kind: 'present', size: st.size };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' };
    return { kind: 'unknown' };
  }
}

/**
 * Remove the legacy triplet in-place. Returns `true` only if every sibling
 * is now gone (either unlinked successfully or already absent with ENOENT).
 * Returns `false` if any unlink threw a non-ENOENT error — caller MUST NOT
 * write a terminal status in that case so the next boot can retry.
 */
function unlinkLegacyTriplet(legacyMetaDbPath: string): boolean {
  let allClean = true;
  for (const suffix of ['', '-wal', '-shm']) {
    const p = legacyMetaDbPath + suffix;
    try {
      fs.unlinkSync(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        log.warn(`Failed to remove ${p}: ${(err as Error).message}`);
        allClean = false;
      }
      // ENOENT means the sibling wasn't there — expected for -wal/-shm in
      // many legit states, not a failure.
    }
  }
  return allClean;
}

/**
 * Open the legacy DB with a read-only-first, read-write-fallback strategy.
 * Strict read-only is forensically clean (no accidental mutation), but it
 * can fail if `-shm` is missing or if SQLite needs to run WAL recovery
 * (which may require write access). The fallback attempts recovery; since
 * `deleteLegacyWorkspaceMetaFiles` removes the whole triplet on success,
 * any incidental mutation from WAL recovery is harmless.
 */
function openLegacy(path: string): Database.Database {
  try {
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch (err) {
    log.warn(`read-only open failed (${(err as Error).message}); retrying read-write`);
    return new Database(path, { readonly: false, fileMustExist: true });
  }
}

export function importLegacyWorkspaceMeta(
  mainDb: Database.Database,
  legacyMetaDbPath: string | undefined,
  preMigrationVersion: number,
): void {
  const status = readStatus(mainDb);

  // ALL non-missing states are terminal. Retry is manual recovery only.
  if (status) return;

  // Status is missing: first (and only) opportunity.
  if (!legacyMetaDbPath) return; // wait for an init that provides the path

  const walPath = legacyMetaDbPath + '-wal';
  // -shm is always disposable: SQLite regenerates it on demand.

  const main = safeFileState(legacyMetaDbPath);
  const wal = safeFileState(walPath);

  const mainEffectivelyEmpty =
    main.kind === 'missing' || (main.kind === 'present' && main.size === 0);
  const walEffectivelyEmpty = wal.kind === 'missing' || (wal.kind === 'present' && wal.size === 0);

  // "Nothing to import" means both main AND WAL are effectively empty.
  // A zero-byte main with a non-empty WAL MIGHT be a pre-checkpoint
  // WAL-mode state that SQLite can recover — or it might be garbage.
  // Either way, do NOT short-circuit-delete: fall through and let
  // openLegacy attempt the open; if it fails, we write status='failed'
  // and preserve the file.
  if (mainEffectivelyEmpty && walEffectivelyEmpty) {
    const cleaned = unlinkLegacyTriplet(legacyMetaDbPath);
    // Only record terminal 'none' on the v30 upgrade boot AND only if
    // cleanup fully succeeded. Cleanup failure → leave status missing so
    // the next boot retries (important: EACCES/EBUSY must not become a
    // permanent "stale file + terminal status" state).
    if (cleaned && preMigrationVersion < 30) {
      writeStatus(mainDb, 'none');
    }
    return;
  }

  // Conflict guard — any of the three destination tables already has rows.
  // Counting all three catches stale workspace_meta / knowledge_notes from
  // a botched recovery, not just the normal auto-created-Default case.
  const existingRows = (
    mainDb
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM workspaces) +
           (SELECT COUNT(*) FROM workspace_meta) +
           (SELECT COUNT(*) FROM knowledge_notes) AS n`,
      )
      .get() as { n: number }
  ).n;
  if (existingRows > 0) {
    log.error(
      `Refusing to import: destination tables already hold ${existingRows} row(s) ` +
        `across workspaces/workspace_meta/knowledge_notes. Manual reconciliation ` +
        `required. Legacy file left at: ${legacyMetaDbPath}`,
    );
    writeStatus(mainDb, 'conflict');
    return;
  }

  let legacyDb: Database.Database;
  try {
    legacyDb = openLegacy(legacyMetaDbPath);
  } catch (err) {
    log.warn(`Could not open legacy DB at ${legacyMetaDbPath}: ${(err as Error).message}`);
    writeStatus(mainDb, 'failed');
    return;
  }

  // Required tables must be present AND copy completely. Optional tables
  // (schema-drifted older installs) may be absent; if present, same count
  // check applies — deletion is irreversible so we fail loud on silent
  // INSERT OR IGNORE skips.
  const tables: Array<{ name: string; cols: string[]; required: boolean }> = [
    {
      name: 'workspaces',
      cols: [
        'id',
        'name',
        'description',
        'color',
        'sort_order',
        'is_default',
        'created_at',
        'updated_at',
      ],
      required: true,
    },
    { name: 'workspace_meta', cols: ['key', 'value'], required: true },
    {
      name: 'knowledge_notes',
      cols: ['id', 'workspace_id', 'type', 'content', 'created_at', 'updated_at'],
      required: false,
    },
  ];

  try {
    const runImport = mainDb.transaction(() => {
      for (const t of tables) {
        const present = legacyDb
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(t.name);
        if (!present) {
          if (t.required) {
            throw new Error(`required table ${t.name} missing from legacy DB`);
          }
          continue; // optional, tolerate
        }

        const rows = legacyDb.prepare(`SELECT ${t.cols.join(',')} FROM ${t.name}`).all() as Record<
          string,
          unknown
        >[];

        const namedPlaceholders = t.cols.map((c) => `@${c}`).join(',');
        const insert = mainDb.prepare(
          `INSERT OR IGNORE INTO ${t.name} (${t.cols.join(',')}) VALUES (${namedPlaceholders})`,
        );

        let inserted = 0;
        for (const r of rows) {
          const bind: Record<string, unknown> = {};
          for (const c of t.cols) bind[c] = r[c] ?? null;
          inserted += insert.run(bind).changes;
        }

        if (inserted !== rows.length) {
          throw new Error(
            `table ${t.name} copy incomplete: ${inserted}/${rows.length} rows inserted ` +
              `(likely duplicate IDs or unique-constraint collisions in legacy data)`,
          );
        }
      }

      // Post-copy verification — BEFORE writing status='copied'. Downstream
      // §5 deletion is irreversible, so every check below must pass.

      // 1. Referential integrity of imported data, scoped to the only
      //    imported table with an FK (knowledge_notes.workspace_id ->
      //    workspaces.id). Scoping matters: an unscoped
      //    `PRAGMA foreign_key_check` would return rows for unrelated
      //    pre-existing FK issues elsewhere in accomplish.db (e.g. an
      //    orphan task_messages row violating task_messages.task_id ->
      //    tasks.id per v001-initial.ts:59), wrongly failing an
      //    otherwise-valid import.
      const fkViolations = mainDb.prepare('PRAGMA foreign_key_check(knowledge_notes)').all();
      if (fkViolations.length > 0) {
        throw new Error(
          `foreign-key violations in imported knowledge_notes: ${JSON.stringify(fkViolations)}`,
        );
      }

      // 2. If legacy had an active_workspace_id pointer, it must resolve
      //    to a workspace row that actually copied over.
      const activePtr = mainDb
        .prepare("SELECT value FROM workspace_meta WHERE key = 'active_workspace_id'")
        .get() as { value: string } | undefined;
      if (activePtr?.value) {
        const target = mainDb.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(activePtr.value);
        if (!target) {
          throw new Error(
            `active_workspace_id '${activePtr.value}' does not resolve to any copied workspace`,
          );
        }
      }

      // Atomic status + path write inside the same transaction as the
      // copies. Both keys land together or not at all; §5 refuses to
      // delete unless the stored path matches what it's handed.
      writeStatus(mainDb, 'copied');
      writeImportPath(mainDb, legacyMetaDbPath);
    });
    runImport();
    log.info(`Imported legacy workspace meta from ${legacyMetaDbPath}`);
  } catch (err) {
    log.warn(`Import rolled back: ${(err as Error).message}`);
    // runImport's transaction already rolled back; mark status on the
    // outer DB (not inside the rolled-back tx) so the terminal 'failed'
    // state persists and we don't retry on every boot.
    writeStatus(mainDb, 'failed');
  } finally {
    legacyDb.close();
  }
}
