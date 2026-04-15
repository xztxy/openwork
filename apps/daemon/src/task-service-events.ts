/**
 * Event type declarations for TaskService.
 * Extracted from task-service.ts to keep files under 200 lines.
 */
import type { TaskMessage, TaskStatus, AccomplishRuntime } from '@accomplish_ai/agent-core';

export interface TaskServiceEvents {
  progress: [data: { taskId: string; stage: string; message?: string }];
  message: [data: { taskId: string; messages: TaskMessage[] }];
  complete: [data: { taskId: string }];
  error: [data: { taskId: string; error: string }];
  permission: [data: unknown];
  statusChange: [data: { taskId: string; status: TaskStatus }];
  summary: [data: { taskId: string; summary: string }];
}

export interface TaskServiceOptions {
  userDataPath: string;
  mcpToolsPath: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  appPath?: string;
  accomplishRuntime?: AccomplishRuntime;
  /**
   * Optional RPC-connectivity probe used by the no-UI auto-deny policy in
   * `task-callbacks.ts` (Phase 2 of the SDK cutover port). The daemon wires
   * this to `rpc.hasConnectedClients`. When omitted (tests, tooling), the
   * task callbacks treat the UI as always connected, so auto-deny only
   * triggers via explicit bridges like WhatsApp.
   */
  rpcConnectivityProbe?: { hasConnectedClients(): boolean };
  /**
   * Optional proxy tagger. Wired by the daemon when an optional runtime
   * module is available at startup. The adapter calls it on task start
   * (with taskId) and teardown (with undefined). Undefined in pure OSS
   * builds — no-op.
   */
  setProxyTaskId?: (taskId: string | undefined) => void;
}
