/**
 * Browser Preview utility functions — IPC helpers and HTTP/CDP resolution helpers.
 * Extracted from browserPreview.ts for ENG-695.
 */

import { BrowserWindow } from 'electron';
import { DEV_BROWSER_CDP_PORT, DEV_BROWSER_PORT } from '@accomplish_ai/agent-core';

export const DEV_BROWSER_HOST = '127.0.0.1';
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
export const COMMAND_TIMEOUT_MS = 10_000;

export type PreviewStatus = 'starting' | 'streaming' | 'loading' | 'ready' | 'stopped' | 'error';

export function sendToRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function emitStatusUpdate(
  taskId: string,
  pageName: string,
  status: PreviewStatus,
  message?: string,
): void {
  sendToRenderer('browser:status', { taskId, pageName, status, message, timestamp: Date.now() });
}

export function emitFrameCapture(
  taskId: string,
  pageName: string,
  data: string,
  width?: number,
  height?: number,
): void {
  sendToRenderer('browser:frame', { taskId, pageName, data, width, height, timestamp: Date.now() });
}

export function emitNavigationEvent(taskId: string, pageName: string, url: string): void {
  sendToRenderer('browser:navigate', { taskId, pageName, url, timestamp: Date.now() });
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveTargetId(taskId: string, pageName: string): Promise<string> {
  const fullPageName = `${taskId}-${pageName}`;
  const result = await fetchJson<{ targetId: string }>(
    `http://${DEV_BROWSER_HOST}:${DEV_BROWSER_PORT}/pages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fullPageName, viewport: DEFAULT_VIEWPORT }),
    },
  );
  if (!result.targetId) {
    throw new Error(`No targetId for page ${fullPageName}`);
  }
  return result.targetId;
}

export async function resolveBrowserWsEndpoint(): Promise<string> {
  const info = await fetchJson<{ webSocketDebuggerUrl: string }>(
    `http://${DEV_BROWSER_HOST}:${DEV_BROWSER_CDP_PORT}/json/version`,
  );
  if (!info.webSocketDebuggerUrl) {
    throw new Error('CDP endpoint missing webSocketDebuggerUrl');
  }
  return info.webSocketDebuggerUrl;
}
