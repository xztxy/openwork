/**
 * OpenCodeAdapter — SDK-based runtime bridge between Accomplish task lifecycle
 * and the `opencode serve` process (via `@opencode-ai/sdk/v2`).
 *
 * Replaces the earlier PTY + stdout-JSON-parsing implementation. Lifecycle:
 *
 *   TaskManager creates adapter →
 *     startTask(config) →
 *       getServerUrl(taskId) resolves URL →
 *       createOpencodeClient({ baseUrl }) →
 *       event.subscribe() opens SSE stream →
 *       session.create(...) → session.prompt(...) →
 *       subscriber loop maps SDK events to OSS adapter events.
 *   sendResponse(response) → permission.reply or question.reply (whichever was
 *     last asked).
 *   cancelTask() → session.abort + abort event subscription.
 *
 * Preserves the full OSS `OpenCodeAdapterEvents` surface so TaskManager and
 * consumers downstream stay unchanged. OSS-only features preserved:
 *   - `'browser-frame'` event (ENG-695 / PR #414) — detected off SDK tool-output
 *     events produced by `dev-browser-mcp`.
 *   - `'auth-error'` event — surfaced both from SDK `session.error` events and
 *     the existing OpenCodeLogWatcher tail.
 *   - CONNECTOR_AUTH_REQUIRED_MARKER detection in assistant text output.
 *   - Sandbox provider wiring (unchanged from the prior adapter).
 *
 * Part of the OpenCode SDK cutover port (commercial PR #720, Phase 1b).
 *
 * NOTE: Runtime task execution does not work end-to-end in this phase — the
 * `getServerUrl` resolver is populated by the daemon in Phase 2. During Phase
 * 1b, unit tests cover adapter construction + event mapping shapes; real task
 * execution requires Phase 2 to wire up a live `opencode serve` instance.
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';

import {
  createOpencodeClient,
  type OpencodeClient,
  type Event as OpenCodeSdkEvent,
  type Part as OpenCodeSdkPart,
  type PermissionRequest as OpenCodeSdkPermissionRequest,
  type QuestionRequest as OpenCodeSdkQuestionRequest,
  type AssistantMessage,
  type Message as OpenCodeSdkMessage,
  type ToolPart,
} from '@opencode-ai/sdk/v2';

import { OpenCodeLogWatcher, createLogWatcher, OpenCodeLogError } from './OpenCodeLogWatcher.js';
import {
  TaskInactivityWatchdog,
  type TaskInactivityWatchdogSnapshot,
  type TaskInactivityWatchdogTimeoutContext,
} from './TaskInactivityWatchdog.js';
import {
  CompletionEnforcer,
  CompletionEnforcerCallbacks,
} from '../../opencode/completion/index.js';

import type { TaskConfig, Task, TaskResult } from '../../common/types/task.js';
import type { OpenCodeMessage } from '../../common/types/opencode.js';
import type { PermissionRequest, PermissionResponse } from '../../common/types/permission.js';
import {
  FILE_PERMISSION_REQUEST_PREFIX,
  QUESTION_REQUEST_PREFIX,
} from '../../common/types/permission.js';
import type { TodoItem } from '../../common/types/todo.js';
import type { SandboxConfig, SandboxProvider } from '../../common/types/sandbox.js';
import type { BrowserFramePayload } from '../../common/types/browser-view.js';
import { DEFAULT_SANDBOX_CONFIG } from '../../common/types/sandbox.js';
import { DisabledSandboxProvider } from '../../sandbox/disabled-provider.js';
import { serializeError } from '../../utils/error.js';
import { getOAuthProviderDisplayName, isOAuthProviderId } from '../../common/types/connector.js';
import { CONNECTOR_AUTH_REQUIRED_MARKER } from '../../common/constants.js';
import { createConsoleLogger } from '../../utils/logging.js';
// `toTaskMessage` and `ModelContext` will be wired when we move to emitting
// pre-processed `TaskMessage` shapes on the event bus (Phase 1c / Phase 2 —
// renderer upsert-by-ID lands there). Today we still emit `OpenCodeMessage`
// synthetic shapes via `partToOpenCodeMessage` for back-compat with the
// existing `message` event consumers.
//
// Keeping this comment so future readers see the intended trajectory.

const log = createConsoleLogger({ prefix: 'OpenCodeAdapter' });

/** Retained for call-site back-compat; the SDK flow no longer uses exit codes. */
export const WINDOWS_CTRL_C_EXIT_CODE = -1073741510;

export const isNormalExit = (code: number | null, platform?: string): boolean =>
  code === 0 || (platform === 'win32' && code === WINDOWS_CTRL_C_EXIT_CODE);

interface ConnectorAuthPauseInput {
  providerId?: string;
  message?: string;
  label?: string;
  pendingLabel?: string;
  successText?: string;
}

export class OpenCodeCliNotFoundError extends Error {
  constructor() {
    super(
      'OpenCode runtime is not available. The bundled runtime may be missing or corrupted. Please reinstall the application.',
    );
    this.name = 'OpenCodeCliNotFoundError';
  }
}

/**
 * Thrown when startTask is invoked without a `getServerUrl` resolver — the
 * SDK adapter requires a live `opencode serve` URL to connect. Phase 2
 * populates this from the daemon's server-manager.
 */
export class OpenCodeRuntimeUnavailableError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'OpenCode runtime URL is not available. Ensure the daemon has started the serve process before starting a task.',
    );
    this.name = 'OpenCodeRuntimeUnavailableError';
  }
}

export interface AdapterOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  tempPath: string;
  /**
   * Resolve the base URL of an `opencode serve` instance for a given task.
   * Populated in Phase 2 by the daemon's server-manager. Required for the
   * SDK adapter; constructors that omit it will succeed, but startTask will
   * throw `OpenCodeRuntimeUnavailableError` until it is wired up.
   */
  getServerUrl?: (taskId: string) => Promise<string | undefined>;
  /**
   * Optional pre-task hook. Returns environment variables to merge into
   * `this.externalEnv` before opening the SDK session. The daemon's
   * `task-config-builder.onBeforeStart` uses this to lazily generate the
   * per-task `opencode.json`, sync API keys to `auth.json`, and surface the
   * resulting `OPENCODE_CONFIG[_DIR]` env vars so the upstream `opencode
   * serve` instance picks them up. Phase 4b removed the unused PTY-era
   * `getCliCommand`, `buildEnvironment`, and `buildCliArgs` siblings — the
   * SDK flow has no equivalent of CLI args (it uses `session.prompt`) and
   * the spawn environment is owned by `apps/daemon/src/opencode/server-manager.ts`.
   */
  onBeforeStart?: () => Promise<NodeJS.ProcessEnv | void>;
  getModelDisplayName?: (modelId: string) => string;
  /** Lazy sandbox factory, called once per adapter instance. */
  sandboxFactory?: () => { provider: SandboxProvider; config: SandboxConfig };
  sandboxProvider?: SandboxProvider;
  sandboxConfig?: SandboxConfig;
  /**
   * Optional LLM-gateway proxy tagger. Called with the current task ID when a
   * task starts, and with `undefined` when it tears down. Allows the fused
   * `@accomplish/llm-gateway-client` (Accomplish Free builds) or a developer-
   * integrated gateway to attribute LLM requests to the originating task.
   *
   * Wired by the daemon at startup: if `@accomplish/llm-gateway-client` is
   * resolvable (Free build CI fuses it into `apps/daemon/dist/node_modules/`
   * per `accomplish-release/.github/workflows/release.yml`), the daemon
   * forwards its `setProxyTaskId` here. In pure OSS builds this stays
   * undefined and the adapter becomes a no-op on this axis.
   */
  setProxyTaskId?: (taskId: string | undefined) => void;
}

export interface OpenCodeAdapterEvents {
  message: [OpenCodeMessage];
  'tool-use': [string, unknown];
  'tool-result': [string];
  'permission-request': [PermissionRequest];
  progress: [{ stage: string; message?: string; modelName?: string }];
  complete: [TaskResult];
  error: [Error];
  debug: [{ type: string; message: string; data?: unknown }];
  'todo:update': [TodoItem[]];
  'auth-error': [{ providerId: string; message: string }];
  /** Live browser preview frame (ENG-695 / PR #414), preserved in the SDK port. */
  'browser-frame': [BrowserFramePayload];
  reasoning: [string];
  'tool-call-complete': [
    {
      toolName: string;
      toolInput: unknown;
      toolOutput: string;
      sessionId?: string;
    },
  ];
  'step-finish': [
    {
      reason: string;
      model?: string;
      tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cache?: { read: number; write: number };
      };
      cost?: number;
    },
  ];
}

/** Shape of an active in-flight request awaiting a caller reply. */
interface PendingRequest {
  kind: 'permission' | 'question';
  /** OSS-facing request ID (prefixed so isFilePermissionRequest/isQuestionRequest work). */
  requestId: string;
  /** Native SDK request ID used for the reply API call. */
  sdkRequestId: string;
  sessionId: string;
}

export class OpenCodeAdapter extends EventEmitter<OpenCodeAdapterEvents> {
  private options: AdapterOptions;
  private sandboxProvider: SandboxProvider;
  private sandboxConfig: SandboxConfig;
  private client: OpencodeClient | null = null;
  private logWatcher: OpenCodeLogWatcher | null = null;
  private completionEnforcer: CompletionEnforcer;

  private currentSessionId: string | null = null;
  private currentTaskId: string | null = null;
  private currentModelId: string | null = null;
  private currentProviderId: string | null = null;
  private lastWorkingDirectory: string | undefined;

  private eventAbortController: AbortController | null = null;
  private eventStreamPromise: Promise<void> | null = null;

  private hasCompleted = false;
  private isDisposed = false;
  private wasInterrupted = false;
  private externalEnv: NodeJS.ProcessEnv | undefined;

  /** Most recent permission/question request awaiting a caller reply. */
  private pendingRequest: PendingRequest | null = null;

  /** Screenshot/frame payload buffer for dev-browser-mcp outputs emitted via SDK tool events. */
  private browserFrameSeen = new Set<string>();

  /**
   * Monotonic counter bumped in `handleSdkEvent` on every SDK event. Feeds
   * the `TaskInactivityWatchdog` fingerprint — each real SDK event advances
   * it, so a stuck task (LLM generation hung, server silent) produces a
   * stable fingerprint and the watchdog escalates.
   */
  private watchdogActivityCounter = 0;
  private watchdog: TaskInactivityWatchdog | null = null;

  constructor(options: AdapterOptions, taskId?: string) {
    super();
    this.options = options;
    this.currentTaskId = taskId ?? null;

    // Sandbox wiring preserved from the prior PTY adapter.
    if (options.sandboxFactory) {
      const { provider, config } = options.sandboxFactory();
      this.sandboxProvider = provider;
      this.sandboxConfig = config;
    } else {
      if (
        options.sandboxConfig &&
        options.sandboxConfig.mode !== 'disabled' &&
        !options.sandboxProvider
      ) {
        throw new Error(
          `sandboxProvider must be supplied when sandboxConfig.mode is "${options.sandboxConfig.mode}". ` +
            'Omitting it causes the task to run unsandboxed on the host.',
        );
      }
      this.sandboxProvider = options.sandboxProvider ?? new DisabledSandboxProvider();
      this.sandboxConfig = options.sandboxConfig ?? DEFAULT_SANDBOX_CONFIG;
    }

    this.completionEnforcer = this.createCompletionEnforcer();
    this.setupLogWatcher();
  }

  // ──────────────────────────── public API ─────────────────────────────────

  async startTask(config: TaskConfig): Promise<Task> {
    if (this.isDisposed) {
      throw new Error('Adapter has been disposed and cannot start new tasks');
    }

    const taskId = config.taskId || this.generateTaskId();
    this.currentTaskId = taskId;
    this.currentSessionId = null;
    this.currentModelId = config.modelId ?? null;
    this.currentProviderId = config.provider ?? null;
    this.hasCompleted = false;
    this.wasInterrupted = false;
    this.pendingRequest = null;
    this.browserFrameSeen.clear();
    this.completionEnforcer.reset();
    this.lastWorkingDirectory = config.workingDirectory;

    // Tag the LLM-gateway proxy with this task so it can attribute outgoing
    // requests. No-op in pure OSS builds where no gateway is wired.
    this.options.setProxyTaskId?.(taskId);

    if (this.logWatcher) {
      await this.logWatcher.start();
    }

    if (this.options.onBeforeStart) {
      this.externalEnv = (await this.options.onBeforeStart()) ?? {};
    }

    // Resolve the running opencode-serve URL. Phase 2 populates this from the
    // daemon's server-manager; until then, startTask fails cleanly.
    if (!this.options.getServerUrl) {
      throw new OpenCodeRuntimeUnavailableError(
        'AdapterOptions.getServerUrl not configured. Daemon server-manager wiring lands in Phase 2 of the SDK cutover port.',
      );
    }
    const serverUrl = await this.options.getServerUrl(taskId);
    if (!serverUrl) {
      throw new OpenCodeRuntimeUnavailableError(
        `No opencode-serve URL available for task ${taskId}.`,
      );
    }

    this.client = createOpencodeClient({ baseUrl: serverUrl });

    this.emit('progress', { stage: 'loading', message: 'Loading agent...' });

    // Open the SDK event subscription before creating the session so we don't
    // miss early events.
    this.eventAbortController = new AbortController();
    this.eventStreamPromise = this.runEventSubscription(this.eventAbortController.signal);

    // Create the session + kick off the prompt.
    const model = this.buildModelParam(config);
    const sessionCreateRes = await this.client.session.create(
      { title: this.deriveTitle(config.prompt) },
      { throwOnError: true },
    );
    const sessionId =
      (sessionCreateRes as { data?: { id?: string }; id?: string }).data?.id ??
      (sessionCreateRes as { id?: string }).id ??
      null;
    if (!sessionId) {
      throw new Error('session.create did not return a session ID');
    }
    this.currentSessionId = sessionId;

    // Start the inactivity watchdog now that we have a session. Defaults
    // from `TaskInactivityWatchdog` give us a 90s stall → soft-timeout
    // nudge followed by 60s post-nudge → hard timeout (total ~2.5 min of
    // zero SDK activity). The watchdog pauses while a permission/question
    // prompt is pending (human input time doesn't count as a stall).
    this.startWatchdog();

    this.emit('progress', { stage: 'waiting', message: 'Waiting for response...' });

    // Fire the prompt. We do NOT await — the response streams via events.
    this.client.session
      .prompt({
        sessionID: sessionId,
        parts: [{ type: 'text', text: config.prompt }],
        ...(model ? { model } : {}),
      })
      .catch((err: unknown) => {
        // Session.prompt errors surface through the event stream too, but
        // we capture them here to avoid unhandled rejections.
        log.warn('session.prompt rejected', { error: serializeError(err) });
      });

    return {
      id: taskId,
      prompt: config.prompt,
      status: 'running',
      sessionId,
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }

  async resumeSession(sessionId: string, prompt: string): Promise<Task> {
    return this.startTask({ prompt, sessionId });
  }

  /**
   * Send a response to an in-flight permission or question request.
   *
   * Signature finalised in Phase 2 of the SDK cutover port — takes a
   * structured `PermissionResponse` carrying:
   *   - `requestId`: the OSS-facing request ID (`filereq_*` or `questionreq_*`)
   *   - `decision`:  'allow' | 'deny'
   *   - `selectedOptions` / `customText`: question-response payload (optional)
   *
   * Routing:
   *   - permission.asked: maps decision to SDK reply shape. 'allow' → 'once'.
   *     There is no 'always' signal at this layer; callers that want
   *     sticky-permission behaviour need a follow-up feature.
   *   - question.asked: packages `selectedOptions` + `customText` as the
   *     SDK's `QuestionAnswer[]`. At least one non-empty answer is required;
   *     if neither is provided and decision is 'deny', we send an empty
   *     answer list via `question.reject`.
   */
  async sendResponse(response: PermissionResponse): Promise<void> {
    // Defense-in-depth: today the daemon guarantees one adapter per task,
    // so `response.taskId` should always match `this.currentTaskId`. A
    // future refactor that shares adapters (pooling, session multiplexing)
    // would break this assumption silently and route responses to the
    // wrong task's pending request. Fail loudly instead.
    if (response.taskId && this.currentTaskId && response.taskId !== this.currentTaskId) {
      throw new Error(
        `sendResponse taskId mismatch: adapter task=${this.currentTaskId}, response task=${response.taskId}`,
      );
    }
    const pending = this.pendingRequest;
    if (!pending) {
      throw new Error('No pending permission or question request to respond to');
    }
    if (!this.client) {
      throw new Error('SDK client not initialised');
    }

    if (pending.kind === 'permission') {
      const reply: 'once' | 'always' | 'reject' = response.decision === 'allow' ? 'once' : 'reject';
      await this.client.permission.reply(
        { requestID: pending.sdkRequestId, reply },
        { throwOnError: true },
      );
    } else {
      // Question reply. Build the `answers` payload from selectedOptions +
      // customText. If both are empty and decision is 'deny', use reject.
      const answers: string[][] = [];
      if (response.selectedOptions && response.selectedOptions.length > 0) {
        answers.push(response.selectedOptions);
      }
      if (response.customText) {
        answers.push([response.customText]);
      }
      if (response.decision === 'deny' && answers.length === 0) {
        await this.client.question.reject(
          { requestID: pending.sdkRequestId },
          { throwOnError: true },
        );
      } else {
        // The SDK expects Array<QuestionAnswer>; QuestionAnswer = Array<string>.
        await this.client.question.reply(
          { requestID: pending.sdkRequestId, answers },
          { throwOnError: true },
        );
      }
    }
    this.pendingRequest = null;
  }

  async cancelTask(): Promise<void> {
    this.wasInterrupted = true;
    await this.abortSession('cancel');
    this.teardown();
  }

  async interruptTask(): Promise<void> {
    this.wasInterrupted = true;
    await this.abortSession('interrupt');
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  getTaskId(): string | null {
    return this.currentTaskId;
  }

  get running(): boolean {
    return this.client !== null && !this.hasCompleted && !this.isDisposed;
  }

  isAdapterDisposed(): boolean {
    return this.isDisposed;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.teardown();
    if (this.logWatcher) {
      this.logWatcher.stop();
      this.logWatcher.removeAllListeners();
      this.logWatcher = null;
    }
    this.removeAllListeners();
  }

  // ──────────────────────────── internals ──────────────────────────────────

  private generateTaskId(): string {
    return crypto.randomUUID();
  }

  private generateRequestId(kind: 'permission' | 'question'): string {
    const prefix = kind === 'permission' ? FILE_PERMISSION_REQUEST_PREFIX : QUESTION_REQUEST_PREFIX;
    return `${prefix}${crypto.randomUUID()}`;
  }

  private deriveTitle(prompt: string): string {
    const trimmed = prompt.trim().split('\n')[0] ?? '';
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
  }

  private buildModelParam(config: TaskConfig): { providerID: string; modelID: string } | null {
    if (!config.modelId || !config.provider) return null;
    return { providerID: config.provider, modelID: config.modelId };
  }

  private createCompletionEnforcer(): CompletionEnforcer {
    const callbacks: CompletionEnforcerCallbacks = {
      onStartContinuation: async (prompt: string) => {
        if (this.currentSessionId && this.client) {
          this.client.session
            .prompt({
              sessionID: this.currentSessionId,
              parts: [{ type: 'text', text: prompt }],
            })
            .catch((err: unknown) => {
              log.warn('continuation prompt rejected', { error: serializeError(err) });
            });
        }
      },
      onComplete: () => {
        this.markComplete('success');
      },
      onDebug: (type: string, message: string, data?: unknown) => {
        this.emit('debug', { type, message, data });
      },
    };
    return new CompletionEnforcer(callbacks);
  }

  private setupLogWatcher(): void {
    this.logWatcher = createLogWatcher();
    this.logWatcher.on('error', (error: OpenCodeLogError) => {
      if (this.hasCompleted || !this.client) return;
      log.info(`Log watcher detected error: ${error.errorName}`);

      const errorMessage = OpenCodeLogWatcher.getErrorMessage(error);

      this.emit('debug', {
        type: 'error',
        message: `[${error.errorName}] ${errorMessage}`,
        data: {
          errorName: error.errorName,
          statusCode: error.statusCode,
          providerID: error.providerID,
          modelID: error.modelID,
          message: error.message,
        },
      });

      if (error.isAuthError && error.providerID) {
        this.emit('auth-error', {
          providerId: error.providerID,
          message: errorMessage,
        });
      }

      this.markComplete('error', errorMessage);
      void this.abortSession('log-error');
    });
  }

  private async runEventSubscription(signal: AbortSignal): Promise<void> {
    if (!this.client) return;
    let subscription;
    try {
      subscription = await this.client.event.subscribe(
        {},
        // AbortSignal is propagated to the underlying fetch via options. The
        // SDK forwards it without declaring it in the Options type; cast to
        // unknown to bypass the narrow declared shape.
        { throwOnError: true, signal } as unknown as Parameters<
          OpencodeClient['event']['subscribe']
        >[1],
      );
    } catch (err) {
      if (!this.isDisposed && !this.wasInterrupted) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.markComplete('error', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    try {
      // subscription.stream is an AsyncIterable<Event>
      const stream = (subscription as { stream: AsyncIterable<OpenCodeSdkEvent> }).stream;
      for await (const event of stream) {
        if (signal.aborted) break;
        try {
          this.handleSdkEvent(event);
        } catch (err) {
          log.warn('event handler threw', { error: serializeError(err) });
        }
      }
    } catch (err) {
      if (!this.isDisposed && !this.wasInterrupted && !signal.aborted) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.markComplete('error', err instanceof Error ? err.message : String(err));
      }
    } finally {
      // Belt-and-braces teardown of the SDK subscription. The AbortSignal
      // path already halts event iteration, but long-running daemons that
      // run many tasks may accumulate subtle socket/fd leaks if the
      // subscription's own handle isn't explicitly released. Best-effort:
      // call `.close()` if the SDK exposes one (version-dependent), else
      // no-op. Swallow errors — the subscription may already be closed by
      // the abort path.
      const maybeClose = (subscription as { close?: () => void | Promise<void> }).close;
      if (typeof maybeClose === 'function') {
        try {
          await Promise.resolve(maybeClose.call(subscription));
        } catch {
          /* ignore — best-effort cleanup */
        }
      }
    }
  }

  private handleSdkEvent(event: OpenCodeSdkEvent): void {
    // Bump the watchdog fingerprint BEFORE the switch so every real SDK
    // event (message, part, delta, permission, question, idle, error,
    // todo…) counts as progress. A hang that produces no events will
    // leave this counter stable, letting the watchdog detect the stall.
    this.watchdogActivityCounter += 1;
    switch (event.type) {
      case 'message.updated': {
        const info = (event.properties as { info: OpenCodeSdkMessage }).info;
        this.handleMessageUpdated(info);
        return;
      }
      case 'message.part.updated': {
        const part = (event.properties as { part: OpenCodeSdkPart }).part;
        this.handlePartUpdated(part);
        return;
      }
      case 'message.part.delta': {
        // Delta updates stream text incrementally; the renderer already
        // coalesces by stable ID when the completed text arrives via
        // message.part.updated. We don't emit per-delta messages to avoid
        // flooding the IPC bus.
        return;
      }
      case 'permission.asked': {
        const sdkReq = event.properties as OpenCodeSdkPermissionRequest;
        this.handlePermissionAsked(sdkReq);
        return;
      }
      case 'question.asked': {
        const sdkReq = event.properties as OpenCodeSdkQuestionRequest;
        this.handleQuestionAsked(sdkReq);
        return;
      }
      case 'session.error': {
        const err = (event.properties as { error?: { message?: string; name?: string } }).error;
        if (err) {
          const msg = err.message ?? 'Session error';
          this.emit('error', new Error(msg));
          this.markComplete('error', msg);
        }
        return;
      }
      case 'session.idle': {
        // Session finished its active work. If completion enforcer considers
        // us done, mark success. Otherwise we wait — a follow-up prompt may
        // re-activate.
        if (!this.hasCompleted && this.completionEnforcer.shouldComplete()) {
          this.markComplete('success');
        }
        return;
      }
      case 'todo.updated': {
        const sdkTodos = (event.properties as { todos: Array<Record<string, unknown>> }).todos;
        // SDK Todo shape: { content, status, priority?, ... } — no `id`. Map
        // into OSS `TodoItem` by synthesising a stable id from index + content.
        const todos: TodoItem[] = (sdkTodos ?? []).map((t, idx) => {
          const rawStatus = t.status;
          const status: TodoItem['status'] =
            rawStatus === 'completed' || rawStatus === 'in_progress' || rawStatus === 'cancelled'
              ? rawStatus
              : 'pending';
          const rawPriority = t.priority;
          const priority: TodoItem['priority'] =
            rawPriority === 'high' || rawPriority === 'low' ? rawPriority : 'medium';
          return {
            id: `todo_${idx}_${String(t.content ?? '').slice(0, 32)}`,
            content: String(t.content ?? ''),
            status,
            priority,
          };
        });
        this.emit('todo:update', todos);
        return;
      }
      default:
        return;
    }
  }

  private handleMessageUpdated(info: OpenCodeSdkMessage): void {
    if (info.role === 'assistant') {
      const assistant = info as AssistantMessage;
      if (assistant.modelID && !this.currentModelId) {
        this.currentModelId = assistant.modelID;
      }
      if (assistant.providerID && !this.currentProviderId) {
        this.currentProviderId = assistant.providerID;
      }
    }
  }

  private handlePartUpdated(part: OpenCodeSdkPart): void {
    // Reasoning parts → OSS `reasoning` event
    if (part.type === 'reasoning') {
      const text = (part as { text?: string }).text;
      if (text) this.emit('reasoning', text);
      return;
    }

    // Text parts — convert via message-processor (handles sanitization, stable IDs,
    // and the new modelContext stamping from Phase 1a).
    if (part.type === 'text') {
      const synthetic = this.partToOpenCodeMessage(part);
      if (synthetic) {
        this.emit('message', synthetic);
      }
      this.checkForConnectorAuthMarker((part as { text?: string }).text ?? '');
      return;
    }

    // Tool parts — convert state transitions (running/completed/error) into
    // `message` events so the renderer can coalesce tool rows.
    if (part.type === 'tool') {
      const toolPart = part as ToolPart;
      const toolName = toolPart.tool ?? 'unknown';
      const state = (toolPart as { state?: { status?: string; input?: unknown; output?: string } })
        .state;
      const status = state?.status;

      if (status === 'running') {
        this.emit('tool-use', toolName, state?.input);
      } else if (status === 'completed' || status === 'error') {
        const output = state?.output ?? '';
        this.emit('tool-result', output);
        this.emit('tool-call-complete', {
          toolName,
          toolInput: state?.input,
          toolOutput: output,
          sessionId: this.currentSessionId ?? undefined,
        });

        // Browser-frame detection: dev-browser-mcp emits JSON frames in its tool
        // output. Parse opportunistically; the renderer relies on this to display
        // live page previews (ENG-695 / PR #414).
        if (toolName === 'dev-browser-mcp' || toolName.endsWith('_dev-browser-mcp')) {
          this.detectBrowserFrames(output);
        }
      }

      const synthetic = this.partToOpenCodeMessage(part);
      if (synthetic) {
        this.emit('message', synthetic);
      }
      return;
    }

    // Step-finish parts carry token usage stats.
    if (part.type === 'step-finish') {
      const sp = part as {
        reason?: string;
        tokens?: {
          input?: number;
          output?: number;
          reasoning?: number;
          cache?: { read?: number; write?: number };
        };
        cost?: number;
      };
      this.emit('step-finish', {
        reason: sp.reason ?? 'unknown',
        model: this.currentModelId ?? undefined,
        tokens: sp.tokens
          ? {
              input: sp.tokens.input ?? 0,
              output: sp.tokens.output ?? 0,
              reasoning: sp.tokens.reasoning ?? 0,
              ...(sp.tokens.cache
                ? { cache: { read: sp.tokens.cache.read ?? 0, write: sp.tokens.cache.write ?? 0 } }
                : {}),
            }
          : undefined,
        cost: sp.cost,
      });
    }
  }

  private handlePermissionAsked(sdkReq: OpenCodeSdkPermissionRequest): void {
    const requestId = this.generateRequestId('permission');
    this.pendingRequest = {
      kind: 'permission',
      requestId,
      sdkRequestId: sdkReq.id,
      sessionId: sdkReq.sessionID,
    };
    const fileOp = this.inferFileOperation(sdkReq);
    const filePath = this.inferFilePath(sdkReq);
    // Note: SDK v2 permission requests reference the originating tool via
    // `tool: { messageID, callID }` — not by name. Resolving to a human-
    // readable tool name would require looking up the tool part separately;
    // the renderer can do that via its existing tool registry. Leave
    // toolName undefined for now.
    const req: PermissionRequest = {
      id: requestId,
      taskId: this.currentTaskId ?? '',
      type: fileOp ? 'file' : 'tool',
      toolInput: sdkReq.metadata,
      ...(fileOp ? { fileOperation: fileOp } : {}),
      ...(filePath ? { filePath } : {}),
      createdAt: new Date().toISOString(),
    };
    this.emit('permission-request', req);
  }

  private handleQuestionAsked(sdkReq: OpenCodeSdkQuestionRequest): void {
    const requestId = this.generateRequestId('question');
    this.pendingRequest = {
      kind: 'question',
      requestId,
      sdkRequestId: sdkReq.id,
      sessionId: sdkReq.sessionID,
    };
    const first = sdkReq.questions?.[0];
    const req: PermissionRequest = {
      id: requestId,
      taskId: this.currentTaskId ?? '',
      type: 'question',
      question: first?.question,
      header: first?.header,
      options: first?.options?.map((o) => ({
        label: o.label,
        description: o.description,
      })),
      multiSelect: first?.multiple,
      createdAt: new Date().toISOString(),
    };
    this.emit('permission-request', req);
  }

  private inferFileOperation(
    req: OpenCodeSdkPermissionRequest,
  ): PermissionRequest['fileOperation'] | undefined {
    const perm = req.permission;
    if (perm === 'edit' || perm === 'modify') return 'modify';
    if (perm === 'write') return 'create';
    if (perm === 'delete') return 'delete';
    return undefined;
  }

  private inferFilePath(req: OpenCodeSdkPermissionRequest): string | undefined {
    const patterns = req.patterns;
    if (Array.isArray(patterns) && patterns.length > 0) return patterns[0];
    return undefined;
  }

  private partToOpenCodeMessage(part: OpenCodeSdkPart): OpenCodeMessage | null {
    // Synthesise an OSS OpenCodeMessage from the SDK part so existing
    // consumers of the `message` event (TaskManager → task-callbacks)
    // continue to work. Phase 1c renderer updates will switch to TaskMessage-
    // shaped events eventually.
    const asAny = part as unknown as {
      id?: string;
      sessionID?: string;
      messageID?: string;
      type?: string;
      text?: string;
      tool?: string;
      state?: { status?: string; input?: unknown; output?: string };
    };

    if (part.type === 'text') {
      const text = asAny.text ?? '';
      return {
        type: 'text',
        part: {
          id: asAny.id ?? '',
          sessionID: asAny.sessionID ?? '',
          messageID: asAny.messageID ?? '',
          type: 'text',
          text,
        },
      } as OpenCodeMessage;
    }

    if (part.type === 'tool') {
      const rawStatus = asAny.state?.status;
      const status: 'pending' | 'running' | 'completed' | 'error' =
        rawStatus === 'running' ||
        rawStatus === 'completed' ||
        rawStatus === 'error' ||
        rawStatus === 'pending'
          ? rawStatus
          : 'pending';
      return {
        type: 'tool_use',
        part: {
          id: asAny.id ?? '',
          sessionID: asAny.sessionID ?? '',
          messageID: asAny.messageID ?? '',
          type: 'tool',
          tool: asAny.tool ?? 'unknown',
          state: {
            status,
            input: asAny.state?.input,
            output: asAny.state?.output,
          },
        },
      };
    }

    return null;
  }

  private checkForConnectorAuthMarker(text: string): void {
    if (!text.includes(CONNECTOR_AUTH_REQUIRED_MARKER)) return;
    const payload = this.parseConnectorAuthPayload(text);
    if (payload?.providerId && isOAuthProviderId(payload.providerId)) {
      this.emit('auth-error', {
        providerId: payload.providerId,
        message:
          payload.message ??
          `${getOAuthProviderDisplayName(payload.providerId)} authentication required`,
      });
    }
  }

  private parseConnectorAuthPayload(text: string): ConnectorAuthPauseInput | null {
    const start = text.indexOf(CONNECTOR_AUTH_REQUIRED_MARKER);
    if (start < 0) return null;
    const after = text.slice(start + CONNECTOR_AUTH_REQUIRED_MARKER.length).trim();
    const braceStart = after.indexOf('{');
    if (braceStart < 0) return null;
    try {
      // Best-effort: find matching closing brace.
      let depth = 0;
      for (let i = braceStart; i < after.length; i++) {
        if (after[i] === '{') depth++;
        else if (after[i] === '}') {
          depth--;
          if (depth === 0) {
            return JSON.parse(after.slice(braceStart, i + 1));
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Parse dev-browser-mcp tool output for JSON-encoded browser frames
   * (ENG-695 / PR #414). The PTY path scanned raw stdout; the SDK path
   * inspects the tool's output field once it reaches `completed` state.
   *
   * Payload shape: `{"type":"browser-frame","taskId":...,"pageName":...,"frame":...,"timestamp":...}`.
   */
  private detectBrowserFrames(output: string): void {
    if (!output) return;
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.includes('"type":"browser-frame"')) continue;
      // Dedup: frame payloads can be replayed across state transitions.
      const fingerprint = trimmed.slice(0, 64);
      if (this.browserFrameSeen.has(fingerprint)) continue;
      this.browserFrameSeen.add(fingerprint);
      try {
        const payload = JSON.parse(trimmed) as BrowserFramePayload & { type?: string };
        if (payload.type === 'browser-frame') {
          this.emit('browser-frame', payload);
        }
      } catch {
        // Malformed line — skip.
      }
    }
  }

  private async abortSession(reason: 'cancel' | 'interrupt' | 'log-error'): Promise<void> {
    this.eventAbortController?.abort();
    if (this.client && this.currentSessionId) {
      try {
        await this.client.session.abort(
          { sessionID: this.currentSessionId },
          { throwOnError: false },
        );
      } catch (err) {
        log.debug?.(`session.abort (${reason}) threw`, { error: serializeError(err) });
      }
    }
  }

  private markComplete(status: TaskResult['status'], error?: string): void {
    if (this.hasCompleted) return;
    this.hasCompleted = true;
    const result: TaskResult = { status, sessionId: this.currentSessionId || undefined };
    if (error) result.error = error;
    this.emit('complete', result);
  }

  private teardown(): void {
    this.watchdog?.stop();
    this.watchdog = null;
    this.eventAbortController?.abort();
    this.eventAbortController = null;
    this.eventStreamPromise = null;
    this.pendingRequest = null;
    this.client = null;
    // Clear LLM-gateway task tag so subsequent non-task LLM calls aren't
    // misattributed. No-op if the callback wasn't wired.
    this.options.setProxyTaskId?.(undefined);
  }

  /**
   * Spin up the inactivity watchdog for this task. Called after the SDK
   * session is created in `startTask`. The watchdog samples every
   * `sampleIntervalMs` (default 5s), considers the task stalled if the
   * fingerprint doesn't advance for `stallTimeoutMs` (default 90s), nudges
   * via `onSoftTimeout`, and hard-fails via `onHardTimeout` after a further
   * `postNudgeTimeoutMs` (default 60s). A pending permission/question
   * request pauses the detection — waiting on a human isn't a stall.
   *
   * Wired lazily here (rather than in the constructor) because the adapter
   * instance is reused across tasks in the queued-task case and we want a
   * fresh timer budget per task.
   */
  private startWatchdog(): void {
    this.watchdog?.stop();
    this.watchdog = new TaskInactivityWatchdog({
      sample: async () => this.sampleWatchdogState(),
      onSoftTimeout: async (ctx) => this.handleWatchdogSoftTimeout(ctx),
      onHardTimeout: async (ctx) => this.handleWatchdogHardTimeout(ctx),
      onDebug: (type, message, data) => {
        log.warn(`[watchdog] ${type}: ${message}`, { data });
      },
    });
    this.watchdog.start();
  }

  private sampleWatchdogState(): TaskInactivityWatchdogSnapshot {
    // Fingerprint combines the session ID, the monotonic activity counter,
    // and the pending-request ID. Any genuine progress (event received, new
    // permission prompt) advances it. A hang leaves it stable.
    const fingerprint = [
      this.currentSessionId ?? 'no-session',
      this.watchdogActivityCounter,
      this.pendingRequest?.sdkRequestId ?? 'no-pending',
    ].join(':');
    // `inProgress: false` tells the watchdog to reset its timer and not
    // escalate. We flip it false in three cases:
    //   - task already completed
    //   - client torn down
    //   - waiting on human input (pending permission/question)
    // Otherwise the session is actively expected to produce events.
    const inProgress =
      !this.hasCompleted &&
      this.client !== null &&
      !this.isDisposed &&
      this.pendingRequest === null;
    return {
      fingerprint,
      inProgress,
      summary: this.currentSessionId ?? undefined,
    };
  }

  private handleWatchdogSoftTimeout(ctx: TaskInactivityWatchdogTimeoutContext): void {
    // Soft timeout: task has been quiet for `stallTimeoutMs`. V1 treats this
    // as a warning and lets the post-nudge timer run — opencode may still
    // produce a late event. Future enhancement: send a session nudge via
    // the SDK to prompt progress. For now, log and continue.
    log.warn(
      `[watchdog] Task stalled (soft timeout, attempt ${ctx.attempt}, elapsed ${ctx.elapsedMs}ms). Waiting for recovery...`,
      { sessionId: this.currentSessionId, taskId: this.currentTaskId },
    );
  }

  private handleWatchdogHardTimeout(ctx: TaskInactivityWatchdogTimeoutContext): void {
    // Hard timeout: task hasn't made progress in soft + post-nudge
    // windows. Fail the task. `markComplete` triggers the standard
    // cleanup chain (error event, teardown, callback).
    const elapsedSec = Math.round(ctx.elapsedMs / 1000);
    const msg = `Task inactivity watchdog: no SDK events for ${elapsedSec}s (hard timeout)`;
    log.error(`[watchdog] ${msg}`, {
      sessionId: this.currentSessionId,
      taskId: this.currentTaskId,
    });
    if (!this.hasCompleted) {
      this.emit('error', new Error(msg));
      this.markComplete('error', msg);
    }
  }
}
