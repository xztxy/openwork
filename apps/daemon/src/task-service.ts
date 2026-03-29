import { EventEmitter } from 'node:events';
import { tmpdir, homedir } from 'node:os';
import {
  createTaskManager,
  createTaskId,
  createMessageId,
  generateTaskSummary,
  validateTaskConfig,
  ensureDevBrowserServer,
  getModelDisplayName,
  type TaskManagerAPI,
  type TaskCallbacks,
  type TaskConfig,
  type Task,
  type TaskMessage,
  type TaskStatus,
  type StorageAPI,
} from '@accomplish_ai/agent-core';
import {
  type TaskConfigBuilderOptions,
  getCliCommand,
  buildEnvironment,
  buildCliArgs,
  isCliAvailable,
  onBeforeStart,
  getBrowserServerConfig,
  createTaskCallbacks,
} from './task-config-builder.js';

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
}

export class TaskService extends EventEmitter {
  private taskManager: TaskManagerAPI;
  private storage: StorageAPI;
  private opts: TaskConfigBuilderOptions;

  constructor(storage: StorageAPI, options: TaskServiceOptions) {
    super();
    this.storage = storage;
    this.opts = {
      userDataPath: options.userDataPath,
      mcpToolsPath: options.mcpToolsPath,
      isPackaged: options.isPackaged ?? false,
      resourcesPath: options.resourcesPath ?? '',
      appPath: options.appPath ?? '',
    };

    this.taskManager = createTaskManager({
      adapterOptions: {
        platform: process.platform,
        isPackaged: this.opts.isPackaged,
        tempPath: tmpdir(),
        getCliCommand: () => getCliCommand(this.opts),
        buildEnvironment: (taskId) => buildEnvironment(taskId, this.storage, this.opts),
        buildCliArgs: (config) => buildCliArgs(config, this.storage),
        onBeforeStart: () => onBeforeStart(this.storage, this.opts),
        getModelDisplayName,
      },
      defaultWorkingDirectory: homedir(),
      maxConcurrentTasks: 10,
      isCliAvailable: () => isCliAvailable(this.opts),
      onBeforeTaskStart: async (callbacks, isFirst) => {
        const browserConfig = getBrowserServerConfig(this.opts);
        if (!browserConfig.mcpToolsPath) {
          return;
        }
        if (isFirst) {
          callbacks.onProgress({
            stage: 'browser',
            message: 'Preparing browser...',
            isFirstTask: isFirst,
          });
        }
        await ensureDevBrowserServer(browserConfig, callbacks.onProgress);
      },
    });
  }

  async startTask(params: {
    prompt: string;
    taskId?: string;
    modelId?: string;
    sessionId?: string;
    workingDirectory?: string;
  }): Promise<Task> {
    const taskId = params.taskId || createTaskId();
    const config: TaskConfig = {
      prompt: params.prompt,
      taskId,
      modelId: params.modelId,
      sessionId: params.sessionId,
      workingDirectory: params.workingDirectory,
    };
    const validatedConfig = validateTaskConfig(config);
    const activeModel = this.storage.getActiveProviderModel();
    const selectedModel = activeModel || this.storage.getSelectedModel();
    if (selectedModel?.model) {
      validatedConfig.modelId = selectedModel.model;
    }

    const callbacks: TaskCallbacks = createTaskCallbacks(
      taskId,
      this,
      this.storage,
      this.taskManager,
    );
    const task = await this.taskManager.startTask(taskId, validatedConfig, callbacks);

    const initialUserMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: validatedConfig.prompt,
      timestamp: new Date().toISOString(),
    };
    task.messages = [initialUserMessage];
    this.storage.saveTask(task);

    generateTaskSummary(validatedConfig.prompt, (provider) => this.storage.getApiKey(provider))
      .then((summary) => {
        this.storage.updateTaskSummary(taskId, summary);
        this.emit('summary', { taskId, summary });
      })
      .catch((err) => {
        console.warn('[TaskService] Failed to generate task summary:', err);
      });

    return task;
  }

  async stopTask(params: { taskId: string }): Promise<void> {
    const { taskId } = params;
    if (this.taskManager.isTaskQueued(taskId)) {
      this.taskManager.cancelQueuedTask(taskId);
      this.storage.updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
      return;
    }
    if (this.taskManager.hasActiveTask(taskId)) {
      await this.taskManager.cancelTask(taskId);
      this.storage.updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
    }
  }

  async interruptTask(params: { taskId: string }): Promise<void> {
    const { taskId } = params;
    if (this.taskManager.hasActiveTask(taskId)) {
      await this.taskManager.interruptTask(taskId);
    }
  }

  async resumeSession(params: {
    sessionId: string;
    prompt: string;
    existingTaskId?: string;
  }): Promise<Task> {
    const { sessionId, prompt, existingTaskId } = params;
    const taskId = existingTaskId || createTaskId();

    if (existingTaskId) {
      const userMessage: TaskMessage = {
        id: createMessageId(),
        type: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      };
      this.storage.addTaskMessage(existingTaskId, userMessage);
    }

    const activeModel = this.storage.getActiveProviderModel();
    const selectedModel = activeModel || this.storage.getSelectedModel();
    const callbacks: TaskCallbacks = createTaskCallbacks(
      taskId,
      this,
      this.storage,
      this.taskManager,
    );
    const task = await this.taskManager.startTask(
      taskId,
      { prompt, sessionId, taskId, modelId: selectedModel?.model },
      callbacks,
    );

    if (existingTaskId) {
      this.storage.updateTaskStatus(existingTaskId, task.status, new Date().toISOString());
    }
    return task;
  }

  listTasks(): Task[] {
    return this.storage.getTasks() as Task[];
  }

  getTaskStatus(params: {
    taskId: string;
  }): { taskId: string; status: TaskStatus; prompt: string; createdAt: string } | null {
    const task = this.storage.getTask(params.taskId);
    if (!task) {
      return null;
    }
    return { taskId: task.id, status: task.status, prompt: task.prompt, createdAt: task.createdAt };
  }

  getActiveTaskId(): string | null {
    return this.taskManager.getActiveTaskId();
  }
  hasActiveTask(taskId: string): boolean {
    return this.taskManager.hasActiveTask(taskId);
  }
  getActiveTaskCount(): number {
    return this.taskManager.getActiveTaskCount();
  }

  async sendResponse(taskId: string, response: string): Promise<void> {
    await this.taskManager.sendResponse(taskId, response);
  }
  dispose(): void {
    this.taskManager.dispose();
  }
}
