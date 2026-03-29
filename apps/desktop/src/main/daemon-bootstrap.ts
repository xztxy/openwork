/**
 * Daemon Bootstrap
 *
 * Connects to the standalone daemon process via Unix socket / Windows named pipe.
 * If no daemon is running, spawns one (detached, survives Electron exit).
 * Registers notification forwarding: daemon pushes → renderer IPC.
 */

import type { BrowserWindow } from 'electron';
import type { DaemonClient } from '@accomplish_ai/agent-core';
import { ensureDaemonRunning } from './daemon/daemon-connector';
import { setClient, setMode, getDaemonClient } from './daemon/daemon-lifecycle';
import { getLogCollector } from './logging';

export { getDaemonClient, getDaemonMode, shutdownDaemon } from './daemon/daemon-lifecycle';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(level, 'daemon', msg);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Boot the daemon — connect to existing or spawn a new one.
 * Returns the connected DaemonClient.
 */
export async function bootstrapDaemon(): Promise<DaemonClient> {
  log('INFO', '[DaemonBootstrap] Connecting to daemon...');

  const client = await ensureDaemonRunning();
  setClient(client);
  setMode('socket');

  log('INFO', '[DaemonBootstrap] Connected to daemon via socket');
  return client;
}

/**
 * Register forwarding of daemon notifications to the renderer process.
 *
 * Maps daemon JSON-RPC notifications to Electron IPC channels that the
 * React UI (via preload contextBridge) already listens on.
 *
 * Uses a dynamic window getter so that if the window is recreated (e.g.
 * macOS `activate` event), notifications route to the current window
 * without re-registering handlers.
 *
 * Must be called after bootstrapDaemon().
 */
export function registerNotificationForwarding(getWindow: () => BrowserWindow | null): void {
  let client: DaemonClient;
  try {
    client = getDaemonClient();
  } catch {
    log('WARN', '[DaemonBootstrap] Cannot register notification forwarding — no daemon client');
    return;
  }

  const forward = (channel: string, data: unknown): void => {
    const win = getWindow();
    if (!win || win.isDestroyed()) {
      return;
    }
    try {
      win.webContents.send(channel, data);
    } catch {
      // Window torn down between check and send — safe to ignore
    }
  };

  // Task execution events
  client.onNotification('task.progress', (data) => {
    forward('task:progress', data);
  });

  client.onNotification('task.message', (data) => {
    forward('task:update:batch', data);
  });

  client.onNotification('task.complete', (data) => {
    forward('task:update', { taskId: data.taskId, type: 'complete', result: data.result });
  });

  client.onNotification('task.error', (data) => {
    forward('task:update', { taskId: data.taskId, type: 'error', error: data.error });
  });

  client.onNotification('task.statusChange', (data) => {
    forward('task:status-change', data);
  });

  client.onNotification('task.summary', (data) => {
    forward('task:summary', data);
  });

  // Permission / question requests
  client.onNotification('permission.request', (data) => {
    forward('permission:request', data);
  });

  // Todo updates
  client.onNotification('todo.update', (data) => {
    forward('todo:update', data);
  });

  // Thought stream events
  client.onNotification('task.thought', (data) => {
    forward('task:thought', data);
  });

  client.onNotification('task.checkpoint', (data) => {
    forward('task:checkpoint', data);
  });

  log('INFO', '[DaemonBootstrap] Notification forwarding registered');
}
