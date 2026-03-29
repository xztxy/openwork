import crypto from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DaemonRpcServer,
  getSocketPath,
  acquirePidLock,
  installCrashHandlers,
  type PidLockHandle,
} from '@accomplish_ai/agent-core';
import { StorageService } from './storage-service.js';
import { TaskService } from './task-service.js';
import { PermissionService } from './permission-service.js';
import { ThoughtStreamService } from './thought-stream-service.js';
import { HealthService, VERSION } from './health.js';
import { parseArgs } from './cli.js';
import { registerRpcMethods } from './daemon-routes.js';
import { registerTaskEventForwarding } from './task-event-forwarding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRAIN_TIMEOUT_MS = 30_000;
let pidLock: PidLockHandle | null = null;

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  installCrashHandlers();
  console.log('[Daemon] Starting...');

  // 1. Acquire PID lock (atomic, with stale detection)
  pidLock = acquirePidLock();
  console.log(`[Daemon] PID lock acquired: ${pidLock.pidPath} (pid=${process.pid})`);

  // 2. Generate per-session auth token for HTTP APIs
  const authToken = crypto.randomUUID();

  // 3. Initialize storage (use shared data dir if provided, enabling shared DB with desktop)
  const storageService = new StorageService();
  const storage = storageService.initialize(args.dataDir);

  // 4. Crash recovery: mark stale running tasks as failed
  for (const task of storage.getTasks()) {
    if (task.status === 'running') {
      console.warn(`[Daemon] Crash recovery: marking stale task ${task.id} as failed`);
      storage.updateTaskStatus(task.id, 'failed', new Date().toISOString());
    }
  }

  // 5. Create services
  const userDataPath = args.dataDir || path.join(homedir(), '.accomplish');
  const mcpToolsPath =
    process.env.MCP_TOOLS_PATH ||
    path.resolve(__dirname, '..', '..', '..', 'packages', 'agent-core', 'mcp-tools');
  const isPackaged = process.env.ACCOMPLISH_IS_PACKAGED === '1';
  const taskService = new TaskService(storage, {
    userDataPath,
    mcpToolsPath,
    isPackaged,
    resourcesPath: process.env.ACCOMPLISH_RESOURCES_PATH,
    appPath: process.env.ACCOMPLISH_APP_PATH,
  });
  const healthService = new HealthService();
  const permissionService = new PermissionService(authToken);
  const thoughtStreamService = new ThoughtStreamService(authToken);

  // 6. Create RPC server
  const rpc = new DaemonRpcServer({
    socketPath: args.socketPath,
    onConnection: (clientId) => console.log(`[Daemon] Client connected: ${clientId}`),
    onDisconnection: (clientId) => console.log(`[Daemon] Client disconnected: ${clientId}`),
  });

  // 7. Initialize permission service
  permissionService.init(
    () => taskService.getActiveTaskId(),
    (request) => rpc.notify('permission.request', request),
  );

  // 8. Set up thought stream event forwarding
  thoughtStreamService.setEventHandlers(
    (event) => rpc.notify('task.thought', event),
    (event) => rpc.notify('task.checkpoint', event),
  );

  // 9 & 10. Register RPC methods and task event forwarding
  const routeServices = {
    rpc,
    taskService,
    permissionService,
    thoughtStreamService,
    healthService,
    storageService,
  };
  registerRpcMethods(routeServices);
  registerTaskEventForwarding(routeServices);

  // 11. Start all servers
  await rpc.start();
  await permissionService.startPermissionApiServer();
  await permissionService.startQuestionApiServer();
  await thoughtStreamService.start();

  // Pass auth token and actual ports to child processes via environment
  const permPorts = permissionService.getPorts();
  const thoughtPort = thoughtStreamService.getPort();
  process.env.ACCOMPLISH_DAEMON_AUTH_TOKEN = authToken;
  if (permPorts.permissionPort) {
    process.env.ACCOMPLISH_PERMISSION_API_PORT = String(permPorts.permissionPort);
  }
  if (permPorts.questionPort) {
    process.env.ACCOMPLISH_QUESTION_API_PORT = String(permPorts.questionPort);
  }
  if (thoughtPort) {
    process.env.ACCOMPLISH_THOUGHT_STREAM_PORT = String(thoughtPort);
  }

  const socketPath = args.socketPath || getSocketPath();
  console.log(`[Daemon] Listening on ${socketPath}`);

  // 12. Graceful shutdown with drain phase
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log('[Daemon] Shutting down...');

    const activeCount = taskService.getActiveTaskCount();
    if (activeCount > 0) {
      console.log(`[Daemon] Draining ${activeCount} active task(s)...`);
      await new Promise<void>((resolve) => {
        let remaining = taskService.getActiveTaskCount();
        if (remaining === 0) {
          resolve();
          return;
        }

        const drainTimeout = setTimeout(() => {
          console.warn('[Daemon] Drain timeout reached, force-killing active tasks');
          taskService.dispose();
          resolve();
        }, DRAIN_TIMEOUT_MS);
        drainTimeout.unref();

        const onComplete = () => {
          remaining = taskService.getActiveTaskCount();
          if (remaining === 0) {
            clearTimeout(drainTimeout);
            taskService.removeListener('complete', onComplete);
            taskService.removeListener('error', onComplete);
            resolve();
          }
        };
        taskService.on('complete', onComplete);
        taskService.on('error', onComplete);
      });
    }

    thoughtStreamService.close();
    permissionService.close();
    taskService.dispose();
    await rpc.stop();
    storageService.close();
    pidLock?.release();
    console.log('[Daemon] Shutdown complete');
    process.exit(0);
  };

  const forceShutdown = () => {
    console.error('[Daemon] Forced shutdown after timeout');
    pidLock?.release();
    process.exit(1);
  };

  process.on('SIGINT', () => {
    setTimeout(forceShutdown, DRAIN_TIMEOUT_MS + 10_000).unref();
    void shutdown();
  });
  process.on('SIGTERM', () => {
    setTimeout(forceShutdown, DRAIN_TIMEOUT_MS + 10_000).unref();
    void shutdown();
  });
}

main().catch((err) => {
  console.error('[Daemon] Fatal error:', err);
  pidLock?.release();
  process.exit(1);
});
