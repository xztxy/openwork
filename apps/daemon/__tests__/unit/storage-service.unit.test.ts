/**
 * Regression tests for `StorageService` bootstrap.
 *
 * Original concern pinned by PR #947: daemon task runs silently dropped
 * workspace knowledge notes because the daemon never opened the sibling
 * `workspace-meta.db` file. That bug is retired by the v030 consolidation
 * (workspace tables now live in `accomplish.db`), so this test now asserts
 * the post-consolidation contract instead:
 *
 *   1. `StorageService.initialize(dataDir)` calls `createStorage` with
 *      `databasePath` AND `legacyMetaDbPath` pointing at the expected
 *      filenames under `dataDir` (dev vs packaged).
 *   2. `storage.initialize()` is invoked BEFORE `deleteLegacyWorkspaceMetaFiles`
 *      — crucial because the delete helper reads `legacy_meta_import_status`
 *      from the main DB, which only exists after init.
 *   3. `deleteLegacyWorkspaceMetaFiles` is called with the SAME
 *      `legacyMetaDbPath` string that was passed to `createStorage`
 *      (byte-identical — both sides reuse the same function-scoped local).
 *
 * Better-sqlite3's native binding can't be loaded in the daemon vitest
 * environment (NODE_MODULE_VERSION mismatch against Electron's bundled
 * Node), so we mock both `createStorage` and `deleteLegacyWorkspaceMetaFiles`
 * from `@accomplish_ai/agent-core` and assert the shape + call order. The
 * real helpers are covered by agent-core's integration suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const createStorageSpy = vi.fn();
const storageInitializeSpy = vi.fn();
const storageCloseSpy = vi.fn();
const deleteLegacySpy = vi.fn();

vi.mock('@accomplish_ai/agent-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createStorage: vi.fn((options: Record<string, unknown>) => {
      createStorageSpy(options);
      return {
        initialize: storageInitializeSpy,
        close: storageCloseSpy,
      };
    }),
    deleteLegacyWorkspaceMetaFiles: vi.fn((p: string) => {
      deleteLegacySpy(p);
    }),
  };
});

const { StorageService } = await import('../../src/storage-service.js');

describe('StorageService bootstrap — consolidated workspace-meta', () => {
  let dataDir: string;

  beforeEach(() => {
    createStorageSpy.mockClear();
    storageInitializeSpy.mockClear();
    storageCloseSpy.mockClear();
    deleteLegacySpy.mockClear();
    delete process.env.ACCOMPLISH_IS_PACKAGED;
    dataDir = join(tmpdir(), `storage-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(() => {
    delete process.env.ACCOMPLISH_IS_PACKAGED;
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('passes both databasePath and legacyMetaDbPath to createStorage in dev mode', () => {
    const svc = new StorageService();
    svc.initialize(dataDir);

    expect(createStorageSpy).toHaveBeenCalledTimes(1);
    const opts = createStorageSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.databasePath).toBe(join(dataDir, 'accomplish-dev.db'));
    expect(opts.legacyMetaDbPath).toBe(join(dataDir, 'workspace-meta-dev.db'));
  });

  it('uses packaged file names when ACCOMPLISH_IS_PACKAGED=1', () => {
    process.env.ACCOMPLISH_IS_PACKAGED = '1';
    const svc = new StorageService();
    svc.initialize(dataDir);

    const opts = createStorageSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.databasePath).toBe(join(dataDir, 'accomplish.db'));
    expect(opts.legacyMetaDbPath).toBe(join(dataDir, 'workspace-meta.db'));
  });

  it('calls deleteLegacyWorkspaceMetaFiles with the same legacy path passed to createStorage', () => {
    const svc = new StorageService();
    svc.initialize(dataDir);

    expect(deleteLegacySpy).toHaveBeenCalledTimes(1);
    const opts = createStorageSpy.mock.calls[0][0] as Record<string, unknown>;
    const expectedPath = opts.legacyMetaDbPath as string;
    const actualPath = deleteLegacySpy.mock.calls[0][0];
    // Byte-identical check: the same string reference should reach both
    // call sites via the function-scoped local inside initialize().
    expect(actualPath).toBe(expectedPath);
  });

  it('invokes storage.initialize() before deleteLegacyWorkspaceMetaFiles', () => {
    const svc = new StorageService();
    svc.initialize(dataDir);

    const initOrder = storageInitializeSpy.mock.invocationCallOrder[0];
    const deleteOrder = deleteLegacySpy.mock.invocationCallOrder[0];
    expect(initOrder).toBeLessThan(deleteOrder);
  });

  it('close() tears down the main storage and does not reference any meta DB', () => {
    const svc = new StorageService();
    svc.initialize(dataDir);
    svc.close();

    expect(storageCloseSpy).toHaveBeenCalledTimes(1);
    // No separate meta-DB close — the tables now live in the main DB.
  });

  it('close() is a no-op when initialize() was never called', () => {
    const svc = new StorageService();
    svc.close();
    expect(storageCloseSpy).not.toHaveBeenCalled();
  });
});
