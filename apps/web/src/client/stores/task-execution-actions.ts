import {
  createMessageId,
  type TaskConfig,
  type Task,
  type TaskStatus,
  type TaskUpdateEvent,
  type PermissionRequest,
  type PermissionResponse,
  type TaskMessage,
} from '@accomplish_ai/agent-core/common';
import { getAccomplish } from '../lib/accomplish';
import type { TaskState } from './taskStore';
import { hasTaskStateToken } from './task-state-helpers';

type SetFn = (partial: Partial<TaskState> | ((state: TaskState) => Partial<TaskState>)) => void;
type GetFn = () => TaskState;

/** Task execution slice: startTask, sendFollowUp, cancelTask, interruptTask, permission handling. */
export function createTaskExecutionActions(set: SetFn, get: GetFn) {
  return {
    startTask: async (config: TaskConfig): Promise<Task | null> => {
      const accomplish = getAccomplish();
      const taskStateToken = get()._taskStateToken;
      set({ isLoading: true, error: null });
      try {
        void accomplish.logEvent({
          level: 'info',
          message: 'UI start task',
          context: { prompt: config.prompt, taskId: config.taskId, files: config.files?.length },
        });
        const task = await accomplish.startTask(config);
        const currentState = get();
        if (!hasTaskStateToken(currentState, taskStateToken)) {
          return null;
        }
        const currentTasks = currentState.tasks;
        set({
          currentTask: task,
          tasks: [task, ...currentTasks.filter((t) => t.id !== task.id)],
          isLoading: task.status === 'queued',
        });
        void accomplish.logEvent({
          level: 'info',
          message: task.status === 'queued' ? 'UI task queued' : 'UI task started',
          context: { taskId: task.id, status: task.status },
        });
        return task;
      } catch (err) {
        if (!hasTaskStateToken(get(), taskStateToken)) {
          return null;
        }
        set({
          error: err instanceof Error ? err.message : 'Failed to start task',
          isLoading: false,
        });
        void accomplish.logEvent({
          level: 'error',
          message: 'UI task start failed',
          context: { error: err instanceof Error ? err.message : String(err) },
        });
        return null;
      }
    },

    sendFollowUp: async (
      message: string,
      attachments?: import('@accomplish_ai/agent-core/common').FileAttachmentInfo[],
    ): Promise<boolean> => {
      const accomplish = getAccomplish();
      const { currentTask, startTask } = get();
      const taskStateToken = get()._taskStateToken;
      if (!currentTask) {
        set({ error: 'No active task to continue' });
        void accomplish.logEvent({ level: 'warn', message: 'UI follow-up failed: no active task' });
        return false;
      }
      const sessionId = currentTask.result?.sessionId || currentTask.sessionId;
      if (!sessionId && currentTask.status === 'interrupted') {
        void accomplish.logEvent({
          level: 'info',
          message: 'UI follow-up: starting fresh task (no session from interrupted task)',
          context: { taskId: currentTask.id },
        });
        const newTask = await startTask({ prompt: message, files: attachments });
        return newTask !== null;
      }
      if (!sessionId) {
        set({ error: 'No session to continue - please start a new task' });
        void accomplish.logEvent({
          level: 'warn',
          message: 'UI follow-up failed: missing session',
          context: { taskId: currentTask.id },
        });
        return false;
      }
      const userMessage: TaskMessage = {
        id: createMessageId(),
        type: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        attachments: attachments
          ? attachments.map((a) => ({ type: 'json', data: 'placeholder', label: a.name }))
          : undefined,
      };
      const taskId = currentTask.id;
      set((state) => ({
        isLoading: true,
        error: null,
        currentTask: state.currentTask
          ? {
              ...state.currentTask,
              status: 'running',
              result: undefined,
              messages: [...state.currentTask.messages, userMessage],
            }
          : null,
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, status: 'running' as TaskStatus } : t,
        ),
      }));
      try {
        void accomplish.logEvent({
          level: 'info',
          message: 'UI follow-up sent',
          context: { taskId: currentTask.id, message, attachments: attachments?.length },
        });
        const task = await accomplish.resumeSession(
          sessionId,
          message,
          currentTask.id,
          attachments,
        );
        if (!hasTaskStateToken(get(), taskStateToken)) {
          return false;
        }
        set((state) => ({
          currentTask: state.currentTask ? { ...state.currentTask, status: task.status } : null,
          isLoading: task.status === 'queued',
          tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)),
        }));
        return true;
      } catch (err) {
        if (!hasTaskStateToken(get(), taskStateToken)) {
          return false;
        }
        set((state) => ({
          error: err instanceof Error ? err.message : 'Failed to send message',
          isLoading: false,
          currentTask: state.currentTask ? { ...state.currentTask, status: 'failed' } : null,
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, status: 'failed' as TaskStatus } : t,
          ),
        }));
        void accomplish.logEvent({
          level: 'error',
          message: 'UI follow-up failed',
          context: {
            taskId: currentTask.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return false;
      }
    },

    cancelTask: async () => {
      const accomplish = getAccomplish();
      const { currentTask } = get();
      if (currentTask) {
        const taskStateToken = get()._taskStateToken;
        void accomplish.logEvent({
          level: 'info',
          message: 'UI cancel task',
          context: { taskId: currentTask.id },
        });
        await accomplish.cancelTask(currentTask.id);
        if (!hasTaskStateToken(get(), taskStateToken)) {
          return;
        }
        set((state) => ({
          currentTask: state.currentTask ? { ...state.currentTask, status: 'cancelled' } : null,
          tasks: state.tasks.map((t) =>
            t.id === currentTask.id ? { ...t, status: 'cancelled' as TaskStatus } : t,
          ),
        }));
      }
    },

    interruptTask: async () => {
      const accomplish = getAccomplish();
      const { currentTask } = get();
      if (currentTask && currentTask.status === 'running') {
        void accomplish.logEvent({
          level: 'info',
          message: 'UI interrupt task',
          context: { taskId: currentTask.id },
        });
        await accomplish.interruptTask(currentTask.id);
      }
    },

    setPermissionRequest: (request: PermissionRequest) => {
      set((state) => ({
        permissionRequests: { ...state.permissionRequests, [request.taskId]: request },
      }));
    },

    clearPermissionRequest: (taskId: string) => {
      set((state) => {
        const { [taskId]: _, ...rest } = state.permissionRequests;
        return { permissionRequests: rest };
      });
    },

    respondToPermission: async (response: PermissionResponse) => {
      const accomplish = getAccomplish();
      const taskStateToken = get()._taskStateToken;
      void accomplish.logEvent({
        level: 'info',
        message: 'UI permission response',
        context: { ...response },
      });
      await accomplish.respondToPermission(response);
      if (!hasTaskStateToken(get(), taskStateToken)) {
        return;
      }
      set((state) => {
        const { [response.taskId]: _, ...rest } = state.permissionRequests;
        return { permissionRequests: rest };
      });
    },

    addTaskUpdate: (event: TaskUpdateEvent) => {
      const accomplish = getAccomplish();
      void accomplish.logEvent({
        level: 'debug',
        message: 'UI task update received',
        context: { ...event },
      });
      set((state) => {
        const isCurrentTask = state.currentTask?.id === event.taskId;
        let updatedCurrentTask = state.currentTask;
        let updatedTasks = state.tasks;
        let newStatus: TaskStatus | null = null;
        if (event.type === 'message' && event.message && isCurrentTask && state.currentTask) {
          updatedCurrentTask = {
            ...state.currentTask,
            messages: [...state.currentTask.messages, event.message],
          };
        }
        if (event.type === 'complete' && event.result) {
          if (event.result.status === 'success') {
            newStatus = 'completed';
          } else if (event.result.status === 'interrupted') {
            newStatus = 'interrupted';
          } else {
            newStatus = 'failed';
          }
          if (isCurrentTask && state.currentTask) {
            updatedCurrentTask = {
              ...state.currentTask,
              status: newStatus,
              result: event.result,
              completedAt: newStatus === 'interrupted' ? undefined : new Date().toISOString(),
              sessionId: event.result.sessionId || state.currentTask.sessionId,
            };
          }
        }
        if (event.type === 'error') {
          newStatus = 'failed';
          if (isCurrentTask && state.currentTask) {
            updatedCurrentTask = {
              ...state.currentTask,
              status: newStatus,
              result: { status: 'error', error: event.error },
            };
          }
        }
        if (newStatus) {
          const finalStatus = newStatus;
          updatedTasks = state.tasks.map((t) =>
            t.id === event.taskId
              ? {
                  ...t,
                  status: finalStatus,
                  ...(isCurrentTask && updatedCurrentTask
                    ? { messages: updatedCurrentTask.messages }
                    : {}),
                }
              : t,
          );
        }
        let shouldClearTodos = false;
        if (
          (event.type === 'complete' || event.type === 'error') &&
          state.todosTaskId === event.taskId
        ) {
          const isInterrupted = event.type === 'complete' && event.result?.status === 'interrupted';
          shouldClearTodos = !isInterrupted;
        }
        return {
          currentTask: updatedCurrentTask,
          tasks: updatedTasks,
          isLoading: false,
          ...(shouldClearTodos ? { todos: [], todosTaskId: null } : {}),
        };
      });
    },

    addTaskUpdateBatch: (event: { taskId: string; messages: TaskMessage[] }) => {
      const accomplish = getAccomplish();
      void accomplish.logEvent({
        level: 'debug',
        message: 'UI task batch update received',
        context: { taskId: event.taskId, messageCount: event.messages.length },
      });
      set((state) => {
        if (!state.currentTask || state.currentTask.id !== event.taskId) {
          return state;
        }
        const updatedTask = {
          ...state.currentTask,
          messages: [...state.currentTask.messages, ...event.messages],
        };
        return { currentTask: updatedTask, isLoading: false };
      });
    },

    updateTaskStatus: (taskId: string, status: TaskStatus) => {
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === taskId ? { ...task, status, updatedAt: new Date().toISOString() } : task,
        ),
        currentTask:
          state.currentTask?.id === taskId
            ? { ...state.currentTask, status, updatedAt: new Date().toISOString() }
            : state.currentTask,
      }));
    },

    setTaskSummary: (taskId: string, summary: string) => {
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, summary } : task)),
        currentTask:
          state.currentTask?.id === taskId ? { ...state.currentTask, summary } : state.currentTask,
      }));
    },
  };
}
