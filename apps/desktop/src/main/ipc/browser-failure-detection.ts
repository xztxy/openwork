import { getLogCollector } from '../logging';
import { recoverDevBrowserServer } from '../opencode';

export const DEV_BROWSER_TOOL_PREFIXES = ['dev-browser-mcp_', 'dev_browser_mcp_', 'browser_'];
export const BROWSER_FAILURE_WINDOW_MS = 12000;
export const BROWSER_FAILURE_THRESHOLD = 2;

const BROWSER_CONNECTION_ERROR_PATTERNS = [
  /fetch failed/i,
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bUND_ERR\b/i,
  /socket hang up/i,
  /\bwebsocket\b/i,
  /browserType\.connectOverCDP/i,
  /Target closed/i,
  /Session closed/i,
  /Page closed/i,
];

export function isDevBrowserToolCall(toolName: string): boolean {
  return DEV_BROWSER_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

export function isBrowserConnectionFailure(output: string): boolean {
  // Guard against false positives from successful outputs that mention words
  // like "WebSocket" while not being an actual error.
  const isExplicitErrorOutput = /^\s*Error:/i.test(output) || /"isError"\s*:\s*true/.test(output);
  if (!isExplicitErrorOutput) {
    return false;
  }

  return BROWSER_CONNECTION_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

export interface BrowserFailureState {
  count: number;
  windowStart: number;
  recoveryInFlight: boolean;
}

export function createBrowserFailureState(): BrowserFailureState {
  return { count: 0, windowStart: 0, recoveryInFlight: false };
}

export function resetBrowserFailureState(state: BrowserFailureState): void {
  state.count = 0;
  state.windowStart = 0;
}

/**
 * Records a new browser failure event. Returns true if recovery should be triggered.
 */
export function recordBrowserFailure(state: BrowserFailureState): boolean {
  const now = Date.now();
  if (state.windowStart === 0 || now - state.windowStart > BROWSER_FAILURE_WINDOW_MS) {
    state.windowStart = now;
    state.count = 1;
  } else {
    state.count += 1;
  }

  return state.count >= BROWSER_FAILURE_THRESHOLD && !state.recoveryInFlight;
}

export interface BrowserToolCallHandlerContext {
  taskId: string;
  state: BrowserFailureState;
  forwardToRenderer: (channel: string, data: unknown) => void;
  isDebugMode: boolean;
}

/**
 * Handle a completed browser tool call, triggering recovery if repeated failures are detected.
 */
export function handleBrowserToolCall(
  toolName: string,
  toolOutput: string,
  ctx: BrowserToolCallHandlerContext,
): void {
  if (!isDevBrowserToolCall(toolName)) {
    return;
  }

  if (!isBrowserConnectionFailure(toolOutput)) {
    resetBrowserFailureState(ctx.state);
    return;
  }

  const now = Date.now();
  const shouldRecover = recordBrowserFailure(ctx.state);

  if (!shouldRecover) {
    return;
  }

  ctx.state.recoveryInFlight = true;
  const reason = `Detected repeated browser connection failures (${ctx.state.count} in ${Math.ceil(
    (now - ctx.state.windowStart) / 1000,
  )}s). Reconnecting browser...`;

  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log('WARN', 'ipc', `[TaskCallbacks] ${reason}`);
    }
  } catch (_e) {
    /* best-effort logging */
  }

  void recoverDevBrowserServer(
    {
      onProgress: (progress) => {
        ctx.forwardToRenderer('task:progress', { taskId: ctx.taskId, ...progress });
      },
    },
    { reason },
  )
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        const l = getLogCollector();
        if (l?.log) {
          l.log('WARN', 'ipc', `[TaskCallbacks] Browser recovery failed: ${errorMessage}`);
        }
      } catch (_e) {
        /* best-effort logging */
      }
      if (ctx.isDebugMode) {
        ctx.forwardToRenderer('debug:log', {
          taskId: ctx.taskId,
          timestamp: new Date().toISOString(),
          type: 'warning',
          message: `Browser recovery failed: ${errorMessage}`,
        });
      }
    })
    .finally(() => {
      ctx.state.recoveryInFlight = false;
      resetBrowserFailureState(ctx.state);
    });
}
