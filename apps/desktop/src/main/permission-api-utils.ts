import type { BrowserWindow } from 'electron';
import { readJsonBody, HttpError } from './http/readJsonBody';

/**
 * Reads and parses a JSON request body, writing an appropriate error response
 * if parsing fails. Returns the parsed body or null (response already sent).
 */
export async function parseJsonRequest<T extends Record<string, unknown>>(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  maxBytes = 1 * 1024 * 1024,
): Promise<T | null> {
  try {
    return await readJsonBody<T>(req, { maxBytes });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 400;
    const message = err instanceof HttpError ? err.message : 'Invalid request';
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
    return null;
  }
}

/**
 * Resolve the task ID from a request body, preferring an explicit taskId
 * from the request (set by MCP server via ACCOMPLISH_TASK_ID env) over
 * the active-task fallback for backwards compatibility.
 */
export function resolveTaskIdFromRequest(
  requestTaskId: unknown,
  taskIdGetter: () => string | null,
): { taskId: string | null; error?: string } {
  if (requestTaskId === undefined) {
    return { taskId: taskIdGetter() };
  }

  if (typeof requestTaskId !== 'string') {
    return { taskId: null, error: 'Invalid task ID' };
  }

  const trimmed = requestTaskId.trim();
  if (trimmed.length === 0) {
    return { taskId: taskIdGetter() };
  }

  return { taskId: trimmed };
}

/** Set CORS headers for local-only API servers. */
export function setCorsHeaders(res: import('http').ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Check if the window and task ID getter are available and ready.
 * Returns an error string if not ready, or null if ready.
 */
export function checkApiReady(
  getMainWindow: (() => BrowserWindow | null) | null,
  getActiveTaskId: (() => string | null) | null,
  apiName: string,
): { currentWindow: BrowserWindow; error?: never } | { currentWindow?: never; error: string } {
  const currentWindow = getMainWindow ? getMainWindow() : null;
  if (!currentWindow || currentWindow.isDestroyed() || !getActiveTaskId) {
    return { error: `${apiName} not initialized` };
  }
  return { currentWindow };
}
