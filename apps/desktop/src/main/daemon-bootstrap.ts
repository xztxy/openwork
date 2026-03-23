/**
 * Daemon Bootstrap
 *
 * Manages the daemon lifecycle with two modes:
 *   1. **Child process** (Step 3): forks a separate Node.js process via IPC channel
 *   2. **In-process** (Step 2 fallback): runs everything in the Electron main process
 *
 * The bootstrap automatically falls back to in-process mode if the child
 * process fails to start.
 */

import { fork, type ChildProcess } from 'child_process';
import path from 'path';
import {
  DaemonServer,
  DaemonClient,
  createInProcessTransportPair,
  createChildProcessTransport,
  addScheduledTask,
  listScheduledTasks,
  cancelScheduledTask,
  disposeScheduler,
  mapResultToStatus,
  createTaskId,
  isFilePermissionRequest,
  isQuestionRequest,
} from '@accomplish_ai/agent-core';
import { resolvePermission, resolveQuestion } from './permission-api';
import type {
  TaskManagerAPI,
  StorageAPI,
  TaskCallbacks,
  TaskMessage,
  TaskResult,
  TaskStatus,
  PermissionResponse,
} from '@accomplish_ai/agent-core';
import { app } from 'electron';
import { getLogCollector } from './logging';

let server: DaemonServer | null = null;
let client: DaemonClient | null = null;
let daemonProcess: ChildProcess | null = null;
let mode: 'child-process' | 'in-process' | null = null;

export interface DaemonBootstrapOptions {
  taskManager: TaskManagerAPI;
  storage: StorageAPI;
}

const DAEMON_READY_TIMEOUT_MS = 10_000;

/**
 * Boot the daemon — tries child process first, falls back to in-process.
 */
export async function bootstrapDaemon(options: DaemonBootstrapOptions): Promise<DaemonClient> {
  const { taskManager, storage } = options;

  // Try child process mode
  try {
    const childClient = await spawnDaemonProcess();
    getLogCollector().logEnv('INFO', '[DaemonBootstrap] Running in child-process mode');
    client = childClient;
    mode = 'child-process';
    return childClient;
  } catch (err) {
    getLogCollector().logEnv(
      'WARN',
      '[DaemonBootstrap] Child process failed, falling back to in-process',
      { error: String(err) },
    );
  }

  // Fallback: in-process mode (Step 2 behavior)
  return bootstrapInProcess(taskManager, storage);
}

/**
 * Boot in-process mode (no child process). This is the Step 2 fallback.
 */
export function bootstrapInProcess(taskManager: TaskManagerAPI, storage: StorageAPI): DaemonClient {
  const { serverTransport, clientTransport } = createInProcessTransportPair();

  server = new DaemonServer({ transport: serverTransport });
  registerInProcessHandlers(server, taskManager, storage);

  client = new DaemonClient({ transport: clientTransport });
  mode = 'in-process';
  getLogCollector().logEnv('INFO', '[DaemonBootstrap] Running in in-process mode');
  return client;
}

/**
 * Fork the daemon as a child process and connect via IPC transport.
 */
async function spawnDaemonProcess(): Promise<DaemonClient> {
  // Resolve the daemon entry script path
  const entryPath = getDaemonEntryPath();

  const userDataPath = app.getPath('userData');

  return new Promise<DaemonClient>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Daemon process did not become ready within timeout'));
      if (daemonProcess) {
        daemonProcess.kill();
        daemonProcess = null;
      }
    }, DAEMON_READY_TIMEOUT_MS);

    try {
      daemonProcess = fork(entryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env },
        serialization: 'advanced',
      });

      // Forward daemon stdout/stderr to our console
      daemonProcess.stdout?.on('data', (data: Buffer) => {
        process.stdout.write(`[Daemon] ${data.toString()}`);
      });
      daemonProcess.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(`[Daemon:err] ${data.toString()}`);
      });

      // Handle errors
      daemonProcess.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      daemonProcess.on('exit', (code) => {
        getLogCollector().logEnv(
          'INFO',
          `[DaemonBootstrap] Daemon process exited with code ${code}`,
        );
        daemonProcess = null;
        // Reject immediately if promise hasn't resolved yet (pre-ready exit)
        clearTimeout(timer);
        reject(new Error(`Daemon process exited before becoming ready (code ${code})`));
      });

      // Wait for "ready" signal
      const onMessage = (msg: unknown): void => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type: string }).type === 'daemon:ready'
        ) {
          clearTimeout(timer);
          daemonProcess?.removeListener('message', onMessage);

          // Create transport + client
          const transport = createChildProcessTransport(daemonProcess!);
          const daemonClient = new DaemonClient({ transport });

          getLogCollector().logEnv('INFO', '[DaemonBootstrap] Daemon process ready', {
            pid: (msg as { pid: number }).pid,
          });
          resolve(daemonClient);
        }
      };

      daemonProcess.on('message', onMessage);

      // Send initialization payload
      daemonProcess.send({
        type: 'daemon:init',
        userDataPath,
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Resolve the path to the daemon entry script.
 */
function getDaemonEntryPath(): string {
  if (app.isPackaged) {
    // In production, the compiled daemon entry is bundled with the app
    return path.join(process.resourcesPath, 'daemon', 'entry.js');
  }
  // In development, use the TypeScript source via ts-node or the compiled output
  return path.join(app.getAppPath(), 'out', 'main', 'daemon', 'entry.js');
}

/**
 * Build task lifecycle callbacks that forward events back through the in-process DaemonServer.
 */
function buildInProcessCallbacks(
  taskId: string,
  srv: DaemonServer,
  storage: StorageAPI,
): TaskCallbacks {
  return {
    onBatchedMessages: (messages: TaskMessage[]) => {
      for (const msg of messages) {
        storage.addTaskMessage(taskId, msg);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srv.notify('task.message' as any, { taskId, messages });
    },
    onProgress: (progress) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srv.notify('task.progress' as any, { taskId, ...progress });
    },
    onPermissionRequest: (request) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srv.notify('permission.request' as any, request);
    },
    onComplete: (result: TaskResult) => {
      const taskStatus = mapResultToStatus(result);
      storage.updateTaskStatus(taskId, taskStatus, new Date().toISOString());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srv.notify('task.complete' as any, { taskId, result });
    },
    onError: (error: Error) => {
      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
      getLogCollector().logEnv('ERROR', `[DaemonBootstrap] Task ${taskId} error`, {
        error: error.message,
      });
    },
    onStatusChange: (status: TaskStatus) => {
      storage.updateTaskStatus(taskId, status, new Date().toISOString());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srv.notify('task.statusChange' as any, { taskId, status });
    },
  };
}

/**
 * Register in-process daemon handlers (same as daemon/entry.ts).
 */
function registerInProcessHandlers(
  srv: DaemonServer,
  taskManager: TaskManagerAPI,
  storage: StorageAPI,
): void {
  srv.registerMethod('task.get', (params) => {
    if (!params) {
      return null;
    }
    return storage.getTask(params.taskId) ?? null;
  });

  srv.registerMethod('task.list', () => storage.getTasks());

  srv.registerMethod('task.delete', (params) => {
    if (params) {
      storage.deleteTask(params.taskId);
    }
  });

  srv.registerMethod('task.clearHistory', () => storage.clearHistory());

  srv.registerMethod('task.getTodos', (params) => {
    if (!params) {
      return [];
    }
    return storage.getTodosForTask(params.taskId);
  });

  srv.registerMethod('task.cancel', async (params) => {
    if (!params) {
      return;
    }
    const { taskId } = params;
    if (taskManager.isTaskQueued(taskId)) {
      taskManager.cancelQueuedTask(taskId);
      storage.updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
      return;
    }
    if (taskManager.hasActiveTask(taskId)) {
      await taskManager.cancelTask(taskId);
      storage.updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
    }
  });

  srv.registerMethod('task.interrupt', async (params) => {
    if (!params) {
      return;
    }
    if (taskManager.hasActiveTask(params.taskId)) {
      await taskManager.interruptTask(params.taskId);
    }
  });

  srv.registerMethod('task.sendResponse', async (params) => {
    if (!params) {
      return;
    }
    await taskManager.sendResponse(params.taskId, params.response);
  });

  srv.registerMethod('task.getActiveIds', () => taskManager.getActiveTaskIds());
  srv.registerMethod('task.getActiveCount', () => taskManager.getActiveTaskCount());

  srv.registerMethod('task.hasActive', (params) => {
    if (!params) {
      return false;
    }
    return taskManager.hasActiveTask(params.taskId);
  });

  srv.registerMethod('task.isQueued', (params) => {
    if (!params) {
      return false;
    }
    return taskManager.isTaskQueued(params.taskId);
  });

  srv.registerMethod('task.cancelQueued', (params) => {
    if (!params) {
      return false;
    }
    const cancelled = taskManager.cancelQueuedTask(params.taskId);
    if (cancelled) {
      storage.updateTaskStatus(params.taskId, 'cancelled', new Date().toISOString());
    }
    return cancelled;
  });

  srv.registerMethod('storage.saveTask', (params) => {
    if (params) {
      storage.saveTask(params.task);
    }
  });

  srv.registerMethod('storage.updateTaskStatus', (params) => {
    if (params) {
      storage.updateTaskStatus(params.taskId, params.status, params.completedAt);
    }
  });

  srv.registerMethod('storage.updateTaskSummary', (params) => {
    if (params) {
      storage.updateTaskSummary(params.taskId, params.summary);
    }
  });

  srv.registerMethod('storage.addTaskMessage', (params) => {
    if (params) {
      storage.addTaskMessage(params.taskId, params.message);
    }
  });

  // ── Task execution ────────────────────────────────────────────────

  srv.registerMethod('task.start', async (params) => {
    const { taskId: providedTaskId, config } = params;
    const taskId = providedTaskId ?? createTaskId();

    // Persist a placeholder first so the task exists in storage before work begins
    const placeholder = {
      taskId,
      status: 'pending' as const,
      config,
      createdAt: new Date().toISOString(),
    };
    storage.saveTask(placeholder as Parameters<StorageAPI['saveTask']>[0]);

    const callbacks = buildInProcessCallbacks(taskId, srv, storage);
    try {
      const task = await taskManager.startTask(taskId, config, callbacks);
      storage.saveTask(task);
      return task;
    } catch (err) {
      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
      throw err;
    }
  });

  srv.registerMethod('session.resume', async (params) => {
    const { sessionId, prompt, existingTaskId } = params;
    const taskId = existingTaskId ?? createTaskId();

    // Persist before starting so the task exists in storage if startTask fails
    if (!existingTaskId) {
      const placeholder = {
        taskId,
        status: 'pending' as const,
        config: { prompt, sessionId },
        createdAt: new Date().toISOString(),
      };
      storage.saveTask(placeholder as Parameters<StorageAPI['saveTask']>[0]);
    }

    const callbacks = buildInProcessCallbacks(taskId, srv, storage);
    try {
      const task = await taskManager.startTask(taskId, { prompt, sessionId }, callbacks);
      if (existingTaskId) {
        storage.updateTaskStatus(existingTaskId, task.status, new Date().toISOString());
      } else {
        storage.saveTask(task);
      }
      return task;
    } catch (err) {
      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
      throw err;
    }
  });

  srv.registerMethod('permission.respond', async (params) => {
    const { response } = params;
    const { taskId, decision, requestId, selectedOptions, customText } =
      response as PermissionResponse;

    if (requestId) {
      // Resolve via the in-process permission handler (used by MCP tools)
      if (isFilePermissionRequest(requestId)) {
        const allowed = decision === 'allow';
        const resolved = resolvePermission(requestId, allowed);
        if (resolved) {
          return;
        }
        getLogCollector().logEnv(
          'WARN',
          `[DaemonBootstrap] No pending file permission request for id: ${requestId}`,
        );
        return;
      }

      if (isQuestionRequest(requestId)) {
        const denied = decision === 'deny';
        const resolved = resolveQuestion(requestId, {
          selectedOptions,
          customText,
          denied,
        });
        if (resolved) {
          return;
        }
        getLogCollector().logEnv(
          'WARN',
          `[DaemonBootstrap] No pending question request for id: ${requestId}`,
        );
        return;
      }

      getLogCollector().logEnv(
        'WARN',
        `[DaemonBootstrap] Unknown requestId format in permission.respond`,
        { requestId },
      );
      return;
    }

    if (!taskManager.hasActiveTask(taskId)) {
      getLogCollector().logEnv('WARN', `[DaemonBootstrap] Permission response for inactive task`, {
        taskId,
      });
      return;
    }

    if (decision === 'allow') {
      const message = selectedOptions?.join(', ') || 'yes';
      await taskManager.sendResponse(taskId, message);
    } else {
      await taskManager.sendResponse(taskId, 'no');
    }
  });

  // ── Scheduling ───────────────────────────────────────────────────

  srv.registerMethod('task.schedule', (params) => {
    if (!params) {
      throw new Error('Missing schedule params');
    }
    return addScheduledTask(params.cron, params.prompt);
  });

  srv.registerMethod('task.listScheduled', () => {
    return listScheduledTasks();
  });

  srv.registerMethod('task.cancelScheduled', (params) => {
    if (params) {
      cancelScheduledTask(params.scheduleId);
    }
  });

  getLogCollector().logEnv('INFO', '[DaemonBootstrap] In-process handlers registered');
}

/**
 * Get the daemon client. Throws if not bootstrapped.
 */
export function getDaemonClient(): DaemonClient {
  if (!client) {
    throw new Error('Daemon not bootstrapped. Call bootstrapDaemon() first.');
  }
  return client;
}

/**
 * Get the daemon server (for pushing notifications). Only available in in-process mode.
 */
export function getDaemonServer(): DaemonServer | null {
  return server;
}

/**
 * Get the current daemon mode.
 */
export function getDaemonMode(): 'child-process' | 'in-process' | null {
  return mode;
}

/**
 * Shut down the daemon.
 */
export function shutdownDaemon(): void {
  if (client) {
    client.close();
    client = null;
  }
  if (server) {
    server.close();
    server = null;
  }
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
  disposeScheduler();
  mode = null;
  getLogCollector().logEnv('INFO', '[DaemonBootstrap] Daemon shut down');
}
