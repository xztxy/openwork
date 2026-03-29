// ── Daemon Task Callbacks (SaaiAravindhRaja / ChaiAndCode — PR #613) ───────────

import { BrowserWindow } from 'electron';
import type { TaskMessage, TaskResult, TaskStatus, TodoItem } from '@accomplish_ai/agent-core';
import { mapResultToStatus } from '@accomplish_ai/agent-core';
import { getTaskManager } from '../opencode';
import type { TaskCallbacks } from '../opencode';
import { getStorage } from '../store/storage';
import { updateTray } from '../tray';
import { notifyTaskCompletion } from '../services/task-notification';

export interface DaemonTaskCallbacksOptions {
  taskId: string;
  getWindow?: () => BrowserWindow | null;
}

export function createDaemonTaskCallbacks(options: DaemonTaskCallbacksOptions): TaskCallbacks {
  const { taskId, getWindow } = options;

  const storage = getStorage();
  const taskManager = getTaskManager();

  const forwardToRenderer = (channel: string, data: unknown) => {
    const win = getWindow?.() ?? BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      return;
    }
    try {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    } catch {
      // Window or webContents torn down between check and send — safe to ignore
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
        const win = getWindow?.() ?? BrowserWindow.getAllWindows()[0];
        if (win) {
          notifyTaskCompletion(win, storage, {
            status: result.status === 'success' ? 'success' : 'error',
            label: `Task ${taskId.slice(0, 8)}`,
          });
        }
      }

      updateTray();
    },

    onError: (error: Error) => {
      forwardToRenderer('task:update', { taskId, type: 'error', error: error.message });
      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
      const win = getWindow?.() ?? BrowserWindow.getAllWindows()[0];
      if (win) {
        notifyTaskCompletion(win, storage, {
          status: 'error',
          label: `Task ${taskId.slice(0, 8)} failed`,
        });
      }
      updateTray();
    },

    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (storage.getDebugMode()) {
        forwardToRenderer('debug:log', { taskId, timestamp: new Date().toISOString(), ...log });
      }
    },

    onStatusChange: (status: TaskStatus) => {
      forwardToRenderer('task:status-change', { taskId, status });
      storage.updateTaskStatus(taskId, status, new Date().toISOString());
      updateTray();
    },

    onTodoUpdate: (todos: TodoItem[]) => {
      storage.saveTodosForTask(taskId, todos);
      forwardToRenderer('todo:update', { taskId, todos });
    },

    onAuthError: (error: { providerId: string; message: string }) => {
      forwardToRenderer('auth:error', error);
    },
  };
}
