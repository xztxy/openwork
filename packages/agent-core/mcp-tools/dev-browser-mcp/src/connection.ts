import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'playwright';
import { BrowserManager, isRecoverableConnectionError } from './browser-manager.js';
export { isRecoverableConnectionError };

export type ConnectionMode = 'builtin' | 'remote';

export interface ConnectionConfig {
  mode: ConnectionMode;
  devBrowserUrl?: string; // builtin: URL of dev-browser HTTP server
  cdpEndpoint?: string; // remote: full CDP WS endpoint
  cdpHeaders?: Record<string, string>;
  taskId: string; // isolates pages: pages are named "{taskId}-{pageName}"
}

// ─── Singleton state ────────────────────────────────────────────────────────

// Use buildConfigFromEnv (hoisted function declaration) to avoid TDZ issue
let _config: ConnectionConfig = buildConfigFromEnv();
const _manager = new BrowserManager();

// ─── Configuration helpers ──────────────────────────────────────────────────

// Pure function: builds config from environment, no side effects
function buildConfigFromEnv(): ConnectionConfig {
  const cdpEndpoint = process.env.CDP_ENDPOINT;
  const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';

  if (cdpEndpoint) {
    const headers: Record<string, string> = {};
    if (process.env.CDP_SECRET) headers['X-CDP-Secret'] = process.env.CDP_SECRET;
    return { mode: 'remote', cdpEndpoint, cdpHeaders: headers, taskId };
  }

  const port = parseInt(process.env.DEV_BROWSER_PORT || '9224', 10);
  return { mode: 'builtin', devBrowserUrl: `http://localhost:${port}`, taskId };
}

// Read from environment and update singleton config
export function configureFromEnv(): ConnectionConfig {
  _config = buildConfigFromEnv();
  _manager.clearCachedBrowser();
  return _config;
}

// Update singleton config directly (for testing or runtime reconfiguration)
export function configure(config: ConnectionConfig): void {
  _config = config;
  _manager.clearCachedBrowser();
}

// Reset singleton state (for testing)
export function resetConnection(): void {
  _config = buildConfigFromEnv();
  _manager.resetConnection();
}

// Page name isolation: always prefix with taskId
export function getFullPageName(pageName?: string): string {
  return `${_config.taskId}-${pageName || 'main'}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getConnectionMode(): ConnectionMode {
  return _config.mode;
}

export async function ensureConnected(): Promise<Browser> {
  return _manager.ensureConnected(() => connectBrowser(_config));
}

export async function getPage(pageName?: string): Promise<Page> {
  const fullName = getFullPageName(pageName);

  if (_config.mode === 'builtin') {
    return getBuiltinPage(fullName);
  }

  return getRemotePage(fullName);
}

export async function listPages(): Promise<string[]> {
  const prefix = `${_config.taskId}-`;

  if (_config.mode === 'builtin') {
    const url = `${_config.devBrowserUrl}/pages`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to list pages: HTTP ${res.status} at ${url}`);
      }
      const data = (await res.json()) as { pages: string[] };
      return data.pages.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length));
    } catch (err) {
      throw new Error(
        `Error listing pages from dev-browser at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Remote mode: return public page names by stripping the taskId prefix
  return Array.from(_manager.getLocalPageRegistry().keys())
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length));
}

export async function closePage(pageName?: string): Promise<boolean> {
  const fullName = getFullPageName(pageName);

  if (_config.mode === 'builtin') {
    const url = `${_config.devBrowserUrl}/pages/${encodeURIComponent(fullName)}`;
    const res = await fetch(url, { method: 'DELETE' });
    return res.ok;
  }

  const registry = _manager.getLocalPageRegistry();
  const page = registry.get(fullName);
  if (!page) return false;
  await page.close().catch(() => {});
  registry.delete(fullName);
  return true;
}

export async function getCDPSession(pageName?: string): Promise<CDPSession> {
  const page = await getPage(pageName);
  const browser = _manager.getBrowser();
  if (!browser) throw new Error('Browser not connected');
  const contexts = browser.contexts();
  const context: BrowserContext | undefined = contexts[0];
  if (!context) throw new Error('No browser context available');
  return context.newCDPSession(page);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function connectBrowser(config: ConnectionConfig): Promise<Browser> {
  if (config.mode === 'remote') {
    return chromium.connectOverCDP(config.cdpEndpoint!, {
      headers: config.cdpHeaders,
    });
  }

  // Builtin: fetch wsEndpoint from dev-browser HTTP server, then connect via CDP
  const infoUrl = `${config.devBrowserUrl}/`;
  const res = await fetch(infoUrl);
  if (!res.ok) throw new Error(`dev-browser health check failed: ${res.status}`);
  const info = (await res.json()) as { wsEndpoint: string };
  return chromium.connectOverCDP(info.wsEndpoint);
}

async function getBuiltinPage(fullName: string): Promise<Page> {
  const url = `${_config.devBrowserUrl}/pages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fullName }),
  });
  if (!res.ok) throw new Error(`Failed to get page "${fullName}": ${res.status}`);
  const data = (await res.json()) as { wsEndpoint: string; targetId: string };

  const browser = await ensureConnected();
  const contexts = browser.contexts();
  const context = contexts[0];
  if (!context) throw new Error('No browser context available');

  const pages = context.pages();
  // First, try to match by targetId via CDP
  for (const page of pages) {
    if (page.isClosed()) continue;
    try {
      const session = await context.newCDPSession(page);
      const { targetInfo } = (await session.send('Target.getTargetInfo')) as {
        targetInfo: { targetId: string };
      };
      await session.detach().catch(() => {});
      if (targetInfo.targetId === data.targetId) return page;
    } catch {
      // try next
    }
  }
  // Fallback: any non-blank, open page
  const match = pages.find((p) => !p.isClosed() && p.url() !== 'about:blank');
  if (match) return match;
  // Last fallback: last open page
  if (pages.length > 0 && !pages[pages.length - 1].isClosed()) {
    return pages[pages.length - 1];
  }
  throw new Error(`Page "${fullName}" not found in browser context`);
}

async function getRemotePage(fullName: string): Promise<Page> {
  const registry = _manager.getLocalPageRegistry();
  const existing = registry.get(fullName);
  if (existing && !existing.isClosed()) return existing;

  const browser = await ensureConnected();
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  registry.set(fullName, page);
  page.on('close', () => registry.delete(fullName));
  return page;
}