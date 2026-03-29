/**
 * Daemon Connector
 *
 * Spawns the daemon as a detached process (survives Electron exit) and
 * connects via Unix socket / Windows named pipe. If the daemon is already
 * running (e.g. started by OS login item), reuses the existing instance.
 *
 * This replaces the old child-process fork approach (daemon-spawn.ts)
 * which killed the daemon when Electron exited.
 */

import { spawn } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { DaemonClient, createSocketTransport, getSocketPath } from '@accomplish_ai/agent-core';
import { getNodePath } from '../utils/bundled-node';
import { getLogCollector } from '../logging';

/** How long to wait for the daemon to become ready after spawning. */
const SPAWN_READY_TIMEOUT_MS = 10_000;
/** Interval between connection attempts while waiting for daemon. */
const POLL_INTERVAL_MS = 200;
/** Short delay to allow a login-item-started daemon to finish booting. */
const LOGIN_ITEM_RETRY_DELAY_MS = 500;

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>): void {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(level, 'daemon', msg, data);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Resolve the data directory for the daemon.
 * Must match the data-dir contract: daemon uses same DB, socket, PID.
 */
function getDataDir(): string {
  return app.getPath('userData');
}

/**
 * Resolve the path to the daemon entry script.
 *
 * - Packaged: bundled at resources/daemon/index.js (pre-built by electron-builder)
 * - Dev: uses the built artifact at apps/daemon/dist/index.js.
 *   The daemon build is triggered by the desktop predev script.
 */
function getDaemonEntryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'daemon', 'index.js');
  }
  // Dev: use built daemon artifact. The predev script ensures this exists.
  const devPath = path.join(app.getAppPath(), '..', 'daemon', 'dist', 'index.js');
  return devPath;
}

/**
 * Try to connect to an already-running daemon.
 * Returns a connected DaemonClient, or null if the daemon is not reachable.
 */
async function tryConnect(dataDir: string): Promise<DaemonClient | null> {
  let transport: Awaited<ReturnType<typeof createSocketTransport>> | null = null;
  let client: DaemonClient | null = null;
  try {
    transport = await createSocketTransport({
      dataDir,
      connectTimeout: 2000,
    });
    client = new DaemonClient({ transport });
    // Verify the daemon is responsive
    await client.ping();
    return client;
  } catch {
    // Clean up on failure to prevent leaked connections
    if (client) {
      client.close();
    } else if (transport) {
      transport.close();
    }
    return null;
  }
}

/**
 * Spawn the daemon as a fully detached process.
 * The daemon process survives Electron exit (detached + unref).
 */
function spawnDaemon(dataDir: string): void {
  const nodeBin = getNodePath();
  const entryPath = getDaemonEntryPath();

  log('INFO', `[DaemonConnector] Spawning daemon: ${nodeBin} ${entryPath} --data-dir ${dataDir}`);

  const child = spawn(nodeBin, [entryPath, '--data-dir', dataDir], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      // Ensure the daemon picks up bundled Node.js for CLI spawning
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });

  // Detach from parent — daemon survives Electron exit
  child.unref();

  log('INFO', `[DaemonConnector] Daemon spawned (detached, pid=${child.pid})`);
}

/**
 * Wait for the daemon to become connectable, polling at POLL_INTERVAL_MS.
 */
async function waitForDaemon(dataDir: string, timeoutMs: number): Promise<DaemonClient> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const client = await tryConnect(dataDir);
    if (client) {
      return client;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Daemon did not become ready within ${timeoutMs}ms. ` +
      `Socket path: ${getSocketPath(dataDir)}`,
  );
}

/**
 * Ensure a daemon is running and return a connected DaemonClient.
 *
 * 1. Try connecting to an existing daemon (may have been started by login item).
 * 2. If not running, wait briefly (login item may still be booting).
 * 3. If still not running, spawn a new daemon (detached + unref).
 * 4. Poll until the daemon is ready.
 */
export async function ensureDaemonRunning(): Promise<DaemonClient> {
  const dataDir = getDataDir();

  // Step 1: Try direct connect
  log('INFO', '[DaemonConnector] Attempting connection to existing daemon...');
  const existing = await tryConnect(dataDir);
  if (existing) {
    log('INFO', '[DaemonConnector] Connected to existing daemon');
    return existing;
  }

  // Step 2: Short retry — login item may still be booting
  log('INFO', '[DaemonConnector] No daemon found, retrying after short delay...');
  await sleep(LOGIN_ITEM_RETRY_DELAY_MS);
  const retried = await tryConnect(dataDir);
  if (retried) {
    log('INFO', '[DaemonConnector] Connected to daemon (login item)');
    return retried;
  }

  // Step 3: Spawn a new daemon
  log('INFO', '[DaemonConnector] Spawning new daemon...');
  spawnDaemon(dataDir);

  // Step 4: Wait for it to become ready
  const client = await waitForDaemon(dataDir, SPAWN_READY_TIMEOUT_MS);
  log('INFO', '[DaemonConnector] Connected to newly spawned daemon');
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
