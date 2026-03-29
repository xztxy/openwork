import { BrowserWindow } from 'electron';
import type {
  TaskMessage,
  TaskResult,
  TaskStatus,
  TodoItem,
  BrowserFramePayload,
} from '@accomplish_ai/agent-core';
import { mapResultToStatus } from '@accomplish_ai/agent-core';
import { getTaskManager } from '../opencode';
import type { TaskCallbacks } from '../opencode';
import { getStorage } from '../store/storage';
import { stopBrowserPreviewStream } from '../services/browserPreview';
import { notifyTaskCompletion } from '../services/task-notification';
import { getLogCollector } from '../logging';
import { createBrowserFailureState, handleBrowserToolCall } from './browser-failure-detection';

export { createDaemonTaskCallbacks } from './daemon-task-callbacks';
export type { DaemonTaskCallbacksOptions } from './daemon-task-callbacks';

export interface TaskCallbacksOptions {
  taskId: string;
  window: BrowserWindow;
  sender: Electron.WebContents;
}

export function createTaskCallbacks(options: TaskCallbacksOptions): TaskCallbacks {
  const { taskId, window, sender } = options;

  const storage = getStorage();
  const taskManager = getTaskManager();
  const browserFailure = createBrowserFailureState();
  let hasRendererSendFailure = false;

  const forwardToRenderer = (channel: string, data: unknown) => {
    if (hasRendererSendFailure) {
      return;
    }
    if (window.isDestroyed() || sender.isDestroyed()) {
      return;
    }
    try {
      sender.send(channel, data);
    } catch (error) {
      hasRendererSendFailure = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        const l = getLogCollector();
        if (l?.log) {
          l.log('ERROR', 'ipc', '[TaskCallbacks] Failed to send IPC event to renderer', {
            taskId,
            channel,
            error: errorMessage,
          });
        }
      } catch (_e) {
        /* best-effort logging */
      }
    }
  };

  return {
    onBatchedMessages: (messages: TaskMessage[]) => {
      forwardToRenderer('task:update:batch', { taskId, messages });
      for (const msg of messages) {
        storage.addTaskMessage(taskId, msg);
      }
    },

    onProgress: (progress: { stage: string; message?: string }) => {
      forwardToRenderer('task:progress', { taskId, ...progress });
    },

    onPermissionRequest: (request: unknown) => {
      forwardToRenderer('permission:request', request);
    },

    onComplete: (result: TaskResult) => {
      forwardToRenderer('task:update', { taskId, type: 'complete', result });

      // Stop any active browser preview stream when the task completes.
      // Contributed by Dev0907 (PR #480) for ENG-695.
      void stopBrowserPreviewStream(taskId);

      const taskStatus = mapResultToStatus(result);
      storage.updateTaskStatus(taskId, taskStatus, new Date().toISOString());

      const sessionId = result.sessionId || taskManager.getSessionId(taskId);
      if (sessionId) {
        storage.updateTaskSessionId(taskId, sessionId);
      }

      if (result.status === 'success') {
        storage.clearTodosForTask(taskId);
      }

      if (result.status !== 'interrupted') {
        notifyTaskCompletion(window, storage, {
          status: result.status === 'success' ? 'success' : 'error',
          label: taskId.slice(0, 8),
        });
      }
    },

    onError: (error: Error) => {
      forwardToRenderer('task:update', { taskId, type: 'error', error: error.message });

      // Stop any active browser preview stream on task error.
      // Contributed by Dev0907 (PR #480) for ENG-695.
      void stopBrowserPreviewStream(taskId);

      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
      notifyTaskCompletion(window, storage, {
        status: 'error',
        label: `Task ${taskId.slice(0, 8)} failed`,
      });
    },

    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (storage.getDebugMode()) {
        forwardToRenderer('debug:log', { taskId, timestamp: new Date().toISOString(), ...log });
      }
    },

    onStatusChange: (status: TaskStatus) => {
      forwardToRenderer('task:status-change', { taskId, status });
      storage.updateTaskStatus(taskId, status, new Date().toISOString());
    },

    onTodoUpdate: (todos: TodoItem[]) => {
      storage.saveTodosForTask(taskId, todos);
      forwardToRenderer('todo:update', { taskId, todos });
    },

    onAuthError: (error: { providerId: string; message: string }) => {
      forwardToRenderer('auth:error', error);
    },

    /**
     * Forward browser preview frames to the renderer.
     * Dev-browser-mcp writes JSON frame lines to stdout; OpenCodeAdapter parses them
     * and emits 'browser-frame' events that reach here via TaskManager.
     *
     * Contributed by samarthsinh2660 (PR #414) for ENG-695.
     */
    onBrowserFrame: (data: BrowserFramePayload) => {
      forwardToRenderer('browser:frame', { taskId, ...data });
    },

    onToolCallComplete: ({ toolName, toolOutput }) => {
      handleBrowserToolCall(toolName, toolOutput, {
        taskId,
        state: browserFailure,
        forwardToRenderer,
        isDebugMode: storage.getDebugMode(),
      });
    },
  };
}
