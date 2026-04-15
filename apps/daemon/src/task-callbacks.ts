/**
 * Task callback factory for TaskService.
 * Extracted from task-config-builder.ts to keep that file under 200 lines.
 *
 * NO electron imports — this runs as plain Node.js.
 */
import type { EventEmitter } from 'node:events';
import {
  mapResultToStatus,
  type TaskCallbacks,
  type TaskMessage,
  type TaskResult,
  type TaskStatus,
  type PermissionRequest,
  type PermissionResponse,
  type TaskSource,
  type StorageAPI,
  type TaskManagerAPI,
} from '@accomplish_ai/agent-core';

/**
 * Minimal RPC-server surface the source-based auto-deny policy depends on.
 * We inject the function rather than a full `DaemonRpcServer` reference to
 * keep the callback factory decoupled from the RPC server's concrete class.
 */
export interface RpcConnectivityProbe {
  hasConnectedClients(): boolean;
}

/**
 * Dependencies the callback factory needs beyond the original four. Added in
 * Phase 2 of the SDK cutover port to replace the deleted `PermissionService`'s
 * no-UI auto-deny safeguard.
 */
export interface TaskCallbackExtras {
  rpc: RpcConnectivityProbe;
  /** Resolve the originating surface (`'ui' | 'whatsapp' | 'scheduler'`) for a task. */
  getTaskSource: (taskId: string) => TaskSource;
  /**
   * Deliver a permission/question response back to the adapter (used by the
   * auto-deny path). Typically a bound `taskService.sendResponse`.
   */
  sendPermissionResponse: (taskId: string, response: PermissionResponse) => Promise<void>;
}

export function createTaskCallbacks(
  taskId: string,
  emitter: EventEmitter,
  storage: StorageAPI,
  taskManager: TaskManagerAPI,
  extras: TaskCallbackExtras,
): TaskCallbacks {
  return {
    onBatchedMessages: (messages: TaskMessage[]) => {
      emitter.emit('message', { taskId, messages });
      for (const msg of messages) {
        storage.addTaskMessage(taskId, msg);
      }
    },
    onProgress: (progress) => {
      emitter.emit('progress', { taskId, ...progress });
    },
    onPermissionRequest: (request: PermissionRequest) => {
      // Source-based dispatch, introduced in Phase 2 of the SDK cutover port
      // to replace the `PermissionService`-era "no UI connected → auto-deny"
      // safeguard (previously implemented inside the permission HTTP handlers).
      //
      //   'whatsapp' + bridge attached: emit; wireTaskBridge auto-denies.
      //   'whatsapp' + no bridge: auto-deny HERE (plan decision #10 guard).
      //   !UI + !whatsapp: auto-deny — no caller will respond.
      //   otherwise (UI source): emit the request to the UI via RPC.
      const source = extras.getTaskSource(taskId);
      const autoDeny = (): void => {
        extras
          .sendPermissionResponse(taskId, {
            taskId,
            requestId: request.id,
            decision: 'deny',
          })
          .catch(() => {
            // Swallow — auto-deny failures are logged at the sendResponse layer.
          });
      };

      if (source === 'whatsapp') {
        // Plan decision #10: if `source === 'whatsapp'` but no WhatsApp
        // bridge is actually subscribed to the 'permission' event (e.g.,
        // WhatsApp integration disabled at runtime), emitting into the
        // void leaves the adapter's `pendingRequest` unresolved and the
        // task hangs forever. Probe listener count — if nothing beyond
        // the daemon's own RPC-notify forwarder is listening, treat as
        // no-UI and auto-deny.
        const listenerCount = emitter.listenerCount('permission');
        if (listenerCount <= 1) {
          autoDeny();
          return;
        }
        emitter.emit('permission', request);
        return;
      }

      if (!extras.rpc.hasConnectedClients()) {
        autoDeny();
        return;
      }

      emitter.emit('permission', request);
    },
    onComplete: (result: TaskResult) => {
      emitter.emit('complete', { taskId, result });
      const taskStatus = mapResultToStatus(result);
      storage.updateTaskStatus(taskId, taskStatus, new Date().toISOString());
      const sessionId = result.sessionId || taskManager.getSessionId(taskId);
      if (sessionId) {
        storage.updateTaskSessionId(taskId, sessionId);
      }
      if (result.status === 'success') {
        storage.clearTodosForTask(taskId);
      }
    },
    onError: (error: Error) => {
      emitter.emit('error', { taskId, error: error.message });
      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
    },
    onStatusChange: (status: TaskStatus) => {
      emitter.emit('statusChange', { taskId, status });
      storage.updateTaskStatus(taskId, status, new Date().toISOString());
    },
    onTodoUpdate: (todos) => {
      storage.saveTodosForTask(taskId, todos);
    },
  };
}
