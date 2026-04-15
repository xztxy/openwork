import { EventEmitter } from 'node:events';
import { tmpdir, homedir } from 'node:os';
import {
  createTaskManager,
  createTaskId,
  createMessageId,
  validateTaskConfig,
  getModelDisplayName,
  type TaskManagerAPI,
  type TaskCallbacks,
  type TaskConfig,
  type Task,
  type TaskMessage,
  type TaskStatus,
  type StorageAPI,
  type PermissionResponse,
  type TaskSource,
} from '@accomplish_ai/agent-core';
import {
  type TaskConfigBuilderOptions,
  getCliCommand,
  buildEnvironment,
  buildCliArgs,
  isCliAvailable,
  onBeforeStart,
  createOnBeforeTaskStart,
  createTaskCallbacks,
  runTaskSummaryGeneration,
} from './task-config-builder.js';
import { OpenCodeServerManager } from './opencode/server-manager.js';

import { type TaskServiceEvents, type TaskServiceOptions } from './task-service-events.js';

export type { TaskServiceEvents, TaskServiceOptions };

export class TaskService extends EventEmitter {
  private taskManager: TaskManagerAPI;
  private storage: StorageAPI;
  private opts: TaskConfigBuilderOptions;
  private rpcConnectivityProbe: { hasConnectedClients(): boolean };
  private serverManager: OpenCodeServerManager;

  /**
   * Per-task origin map. Populated at task start, read by the source-based
   * no-UI auto-deny policy in `task-callbacks.ts` (Phase 2 of the SDK cutover
   * port) and cleared when the task is removed from activeTasks. Not intended
   * for RPC exposure; strictly internal to the daemon.
   */
  private taskSources = new Map<string, TaskSource>();

  constructor(storage: StorageAPI, options: TaskServiceOptions) {
    super();
    this.storage = storage;
    this.opts = {
      ...options,
      isPackaged: options.isPackaged ?? false,
      resourcesPath: options.resourcesPath ?? '',
      appPath: options.appPath ?? '',
      accomplishRuntime: options.accomplishRuntime,
    };
    // Default probe: treat UI as always connected. Tests + tooling that
    // construct TaskService without an RPC server get this default — the
    // no-UI auto-deny path is never triggered, which keeps unit tests
    // deterministic. The real daemon wires `rpc.hasConnectedClients`.
    this.rpcConnectivityProbe = options.rpcConnectivityProbe ?? {
      hasConnectedClients: () => true,
    };

    // Drop the per-task source entry when the task finishes, whether via
    // success, error, or cancel. Listening to our own emitter (task-callbacks
    // emits into `this`) keeps the bookkeeping local without exposing the map.
    this.on('complete', (data: { taskId: string }) => {
      this.taskSources.delete(data.taskId);
      this.serverManager.scheduleTaskRuntimeCleanup(data.taskId);
    });
    this.on('error', (data: { taskId: string }) => {
      this.taskSources.delete(data.taskId);
      this.serverManager.scheduleTaskRuntimeCleanup(data.taskId);
    });

    // Per-task `opencode serve` manager. Spawns one serve process per task,
    // cleans up on idle. The `getServerUrl` closure below is handed to the
    // SDK adapter so it can connect its `createOpencodeClient` to the right
    // runtime.
    this.serverManager = new OpenCodeServerManager({
      storage,
      userDataPath: this.opts.userDataPath,
      mcpToolsPath: this.opts.mcpToolsPath,
      isPackaged: this.opts.isPackaged,
      resourcesPath: this.opts.resourcesPath,
      appPath: this.opts.appPath,
      accomplishRuntime: this.opts.accomplishRuntime,
    });

    this.taskManager = createTaskManager({
      adapterOptions: {
        platform: process.platform,
        isPackaged: this.opts.isPackaged,
        tempPath: tmpdir(),
        getCliCommand: () => getCliCommand(this.opts),
        buildEnvironment: (taskId) => buildEnvironment(taskId, this.storage, this.opts),
        buildCliArgs: (config) => buildCliArgs(config, this.storage),
        onBeforeStart: async () => {
          const result = await onBeforeStart(this.storage, this.opts);
          return result.env;
        },
        // SDK-based adapter resolves its `opencode serve` URL here.
        getServerUrl: async (taskId) => {
          await this.serverManager.ensureTaskRuntime(taskId);
          return this.serverManager.waitForServerUrl(taskId);
        },
        getModelDisplayName,
        // LLM-gateway proxy tagger — the adapter calls this on task start
        // (with taskId) and teardown (with undefined). Wired by the daemon
        // at startup when `@accomplish/llm-gateway-client` is resolvable;
        // undefined for pure OSS builds (no-op).
        setProxyTaskId: options.setProxyTaskId,
      },
      defaultWorkingDirectory: homedir(),
      maxConcurrentTasks: 10,
      isCliAvailable: () => isCliAvailable(this.opts),
      onBeforeTaskStart: createOnBeforeTaskStart(this.opts),
    });
  }

  async startTask(params: {
    prompt: string;
    taskId?: string;
    modelId?: string;
    sessionId?: string;
    workingDirectory?: string;
    workspaceId?: string;
    systemPromptAppend?: string;
    /**
     * Originating surface. Drives the no-UI auto-deny safeguard for
     * permission/question prompts when the task runs headlessly. Defaults
     * to `'ui'` when not provided. WhatsApp bridge and scheduler callers
     * must set this explicitly.
     */
    source?: TaskSource;
  }): Promise<Task> {
    const taskId = params.taskId || createTaskId();
    const config: TaskConfig = {
      prompt: params.prompt,
      taskId,
      modelId: params.modelId,
      sessionId: params.sessionId,
      workingDirectory: params.workingDirectory,
      systemPromptAppend: params.systemPromptAppend,
      source: params.source,
    };
    const validatedConfig = validateTaskConfig(config);
    // Record task source for the no-UI auto-deny policy in task-callbacks.
    // Validation defaults unknown/missing values to undefined; treat as 'ui'.
    this.taskSources.set(taskId, validatedConfig.source ?? 'ui');
    const activeModel = this.storage.getActiveProviderModel();
    const selectedModel = activeModel || this.storage.getSelectedModel();
    if (selectedModel?.model && !validatedConfig.modelId) {
      validatedConfig.modelId = selectedModel.model;
    }

    const task = await this._runTask(taskId, validatedConfig);

    const initialUserMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: validatedConfig.prompt,
      timestamp: new Date().toISOString(),
    };
    task.messages = [initialUserMessage];
    this.storage.saveTask(task, params.workspaceId);

    runTaskSummaryGeneration(taskId, validatedConfig.prompt, this.storage, (summary) => {
      this.emit('summary', { taskId, summary });
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
    const task = await this._runTask(taskId, {
      prompt,
      sessionId,
      taskId,
      modelId: selectedModel?.model,
    });

    if (existingTaskId) {
      this.storage.updateTaskStatus(existingTaskId, task.status, new Date().toISOString());
    }
    return task;
  }

  private async _runTask(taskId: string, config: TaskConfig): Promise<Task> {
    const callbacks: TaskCallbacks = createTaskCallbacks(
      taskId,
      this,
      this.storage,
      this.taskManager,
      {
        rpc: this.rpcConnectivityProbe,
        getTaskSource: (id) => this.getTaskSource(id),
        // Bind sendResponse for the auto-deny path. Callback-in-object form
        // sidesteps the circular "TaskService constructs callbacks that call
        // back into TaskService" problem — no `this` capture at setup time.
        sendPermissionResponse: async (id, response) => {
          await this.sendResponse(id, response);
        },
      },
    );
    return this.taskManager.startTask(taskId, config, callbacks);
  }

  listTasks(workspaceId?: string, includeUnassigned = false): Task[] {
    return this.storage.getTasks(workspaceId, includeUnassigned) as Task[];
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

  async sendResponse(taskId: string, response: PermissionResponse): Promise<void> {
    await this.taskManager.sendResponse(taskId, response);
  }

  /**
   * Task origin lookup — used by `task-callbacks.ts` `onPermissionRequest` to
   * decide whether to emit a UI prompt, route through the WhatsApp bridge,
   * or immediately auto-deny when no UI client is connected and the task
   * was not started by WhatsApp or another auto-denying caller.
   */
  getTaskSource(taskId: string): TaskSource {
    return this.taskSources.get(taskId) ?? 'ui';
  }

  dispose(): void {
    this.serverManager.dispose();
    this.taskManager.dispose();
  }
}
