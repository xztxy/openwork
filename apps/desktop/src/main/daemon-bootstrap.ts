/**
 * Daemon Bootstrap
 *
 * Temporary no-op stub — the in-process daemon and child-process fork have been
 * removed as dead code. This file will be rewritten in Phase 4 to connect to the
 * standalone daemon process via Unix socket / Windows named pipe.
 */

import { getLogCollector } from './logging';

export { getDaemonClient, getDaemonMode, shutdownDaemon } from './daemon/daemon-lifecycle';

/**
 * Boot the daemon — currently a no-op pending socket migration.
 *
 * Will be rewritten to call `ensureDaemonRunning()` in Phase 4.
 */
export async function bootstrapDaemon(): Promise<void> {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(
        'INFO',
        'daemon',
        '[DaemonBootstrap] Daemon bootstrap skipped — pending socket migration',
      );
    }
  } catch {
    /* best-effort logging */
  }
}
