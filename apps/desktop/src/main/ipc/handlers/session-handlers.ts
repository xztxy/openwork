/**
 * IPC handler for session:resume.
 * Extracted from task-handlers.ts to keep files under 200 lines.
 */
import { BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import {
  sanitizeString,
  createTaskId,
  createMessageId,
  type TaskMessage,
  type FileAttachmentInfo,
} from '@accomplish_ai/agent-core';
import { getStorage } from '../../store/storage';
import { getTaskManager } from '../../opencode';
import { isMockTaskEventsEnabled } from '../../test-utils/mock-task-flow';
import * as workspaceManager from '../../store/workspaceManager';
import { createTaskCallbacks } from '../../ipc/task-callbacks';
import { handle, assertTrustedWindow } from './utils';
import { registerPermissionHandlers } from './permission-ipc';
import { sanitizeAttachments } from './attachment-utils';

export function registerSessionHandlers(): void {
  const storage = getStorage();
  const taskManager = getTaskManager();
  const ensurePermissionApiInitialized = registerPermissionHandlers(taskManager);

  handle(
    'session:resume',
    async (
      event: IpcMainInvokeEvent,
      sessionId: string,
      prompt: string,
      existingTaskId?: string,
      attachments?: FileAttachmentInfo[],
    ) => {
      const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
      const sender = event.sender;
      const validatedSessionId = sanitizeString(sessionId, 'sessionId', 128);
      const validatedPrompt = sanitizeString(prompt, 'prompt');
      const validatedExistingTaskId = existingTaskId
        ? sanitizeString(existingTaskId, 'taskId', 128)
        : undefined;

      if (!isMockTaskEventsEnabled() && !storage.hasReadyProvider()) {
        throw new Error(
          'No provider is ready. Please connect a provider and select a model in Settings.',
        );
      }

      await ensurePermissionApiInitialized(window, () => taskManager.getActiveTaskId());

      const taskId = validatedExistingTaskId || createTaskId();
      const sanitizedAttachments = sanitizeAttachments(attachments as unknown[] | undefined);

      const activeModelForResume = storage.getActiveProviderModel();
      const selectedModelForResume = activeModelForResume || storage.getSelectedModel();
      const callbacks = createTaskCallbacks({ taskId, window, sender });

      const userMessage: TaskMessage = {
        id: createMessageId(),
        type: 'user',
        content: validatedPrompt,
        timestamp: new Date().toISOString(),
      };

      const task = await taskManager.startTask(
        taskId,
        {
          prompt: validatedPrompt,
          sessionId: validatedSessionId,
          taskId,
          modelId: selectedModelForResume?.model,
          files: sanitizedAttachments,
        },
        callbacks,
      );

      if (validatedExistingTaskId) {
        storage.addTaskMessage(validatedExistingTaskId, userMessage);
        storage.updateTaskStatus(validatedExistingTaskId, task.status, new Date().toISOString());
      } else {
        // New task created by session:resume — persist it so it appears in task history.
        task.messages = [userMessage];
        storage.saveTask(task, workspaceManager.getActiveWorkspace());
      }

      return task;
    },
  );
}
