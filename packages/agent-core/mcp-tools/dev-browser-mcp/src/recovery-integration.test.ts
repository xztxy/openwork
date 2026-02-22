/**
 * Recovery integration tests: verify crash recovery with real HTTP servers
 * and real transport errors (ECONNREFUSED).
 *
 * These tests launch a real headless Chromium, create a mock dev-browser HTTP
 * server, and exercise the recovery path with actual network failures.
 *
 * Run: npx vitest run src/recovery-integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { configure, ensureConnected, resetConnection, fetchWithRetry } from './connection.js';
import { isTransportError, attemptRecovery, _resetRecoveryState } from './recovery.js';

let chromiumProcess: ChildProcess;
let cdpWsEndpoint: string;

// ---------------------------------------------------------------------------
// Chromium launcher (same pattern as integration.test.ts)
// ---------------------------------------------------------------------------

async function launchChromiumWithCDP(): Promise<{ process: ChildProcess; wsEndpoint: string }> {
  const executablePath = chromium.executablePath();
  const port = 9333 + Math.floor(Math.random() * 1000);

  const proc = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const wsEndpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for CDP endpoint')),
      10000,
    );
    let stderrData = '';

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
      const match = stderrData.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]!);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`Chromium exited with code ${code} before CDP was ready. stderr: ${stderrData}`),
      );
    });
  });

  return { process: proc, wsEndpoint };
}

// ---------------------------------------------------------------------------
// Mock dev-browser HTTP server
// ---------------------------------------------------------------------------

function createMockDevBrowserServer(wsEndpoint: string): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wsEndpoint, mode: 'normal' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/pages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ targetId: 'mock-target-id' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/pages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pages: [] }));
      return;
    }

    if (req.method === 'DELETE' && req.url?.startsWith('/pages/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });
}

function startServer(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
    server.on('error', reject);
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const result = await launchChromiumWithCDP();
  chromiumProcess = result.process;
  cdpWsEndpoint = result.wsEndpoint;
}, 30000);

afterAll(async () => {
  resetConnection();
  if (chromiumProcess && !chromiumProcess.killed) {
    chromiumProcess.kill();
  }
});

beforeEach(() => {
  resetConnection();
  _resetRecoveryState();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Recovery Integration', () => {
  it('connects through mock dev-browser server', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);

    try {
      configure({
        mode: 'builtin',
        devBrowserUrl: `http://127.0.0.1:${port}`,
        taskId: 'recovery-test',
      });

      const browser = await ensureConnected();
      expect(browser.isConnected()).toBe(true);
    } finally {
      resetConnection();
      await stopServer(server);
    }
  }, 15000);

  it('mock server handles page API requests', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const rootRes = await fetchWithRetry(baseUrl);
      expect(rootRes.ok).toBe(true);
      const rootData = (await rootRes.json()) as { wsEndpoint: string };
      expect(rootData.wsEndpoint).toBe(cdpWsEndpoint);

      const pagesRes = await fetchWithRetry(`${baseUrl}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-page' }),
      });
      expect(pagesRes.ok).toBe(true);

      const listRes = await fetchWithRetry(`${baseUrl}/pages`);
      expect(listRes.ok).toBe(true);
    } finally {
      await stopServer(server);
    }
  }, 15000);

  it('server crash produces real transport errors detected by isTransportError', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);
    await stopServer(server);

    let caughtError: Error | null = null;
    try {
      await fetchWithRetry(`http://127.0.0.1:${port}`, undefined, 1, 10);
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(isTransportError(caughtError!)).toBe(true);
  }, 15000);

  it('attemptRecovery returns true when server restarts during polling', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);
    const serverUrl = `http://127.0.0.1:${port}`;

    // Configure so resetConnection() inside attemptRecovery has config
    configure({
      mode: 'builtin',
      devBrowserUrl: serverUrl,
      taskId: 'recovery-test',
    });

    // Stop the server to simulate crash
    await stopServer(server);

    // Restart on the same port after 500ms
    setTimeout(async () => {
      const newServer = createMockDevBrowserServer(cdpWsEndpoint);
      await startServer(newServer, port);
      // Clean up the restarted server after the test
      setTimeout(() => {
        newServer.close();
      }, 10000);
    }, 500);

    const result = await attemptRecovery(serverUrl);
    expect(result).toBe(true);
  }, 15000);

  it('after recovery, ensureConnected works again', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);
    const serverUrl = `http://127.0.0.1:${port}`;

    configure({
      mode: 'builtin',
      devBrowserUrl: serverUrl,
      taskId: 'recovery-test',
    });

    // Connect initially
    const browser1 = await ensureConnected();
    expect(browser1.isConnected()).toBe(true);

    // Stop server to simulate crash
    await stopServer(server);
    resetConnection();

    // Restart the server on the same port
    const newServer = createMockDevBrowserServer(cdpWsEndpoint);
    await startServer(newServer, port);

    try {
      const recovered = await attemptRecovery(serverUrl);
      expect(recovered).toBe(true);

      const browser2 = await ensureConnected();
      expect(browser2.isConnected()).toBe(true);
    } finally {
      resetConnection();
      await stopServer(newServer);
    }
  }, 15000);

  it('attemptRecovery returns false when server stays down', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);
    const serverUrl = `http://127.0.0.1:${port}`;

    configure({
      mode: 'builtin',
      devBrowserUrl: serverUrl,
      taskId: 'recovery-test',
    });

    // Stop server and never restart
    await stopServer(server);

    const result = await attemptRecovery(serverUrl);
    expect(result).toBe(false);
  }, 15000);

  it('cooldown prevents second recovery within 10s', async () => {
    const server = createMockDevBrowserServer(cdpWsEndpoint);
    const port = await startServer(server);
    const serverUrl = `http://127.0.0.1:${port}`;

    configure({
      mode: 'builtin',
      devBrowserUrl: serverUrl,
      taskId: 'recovery-test',
    });

    try {
      const first = await attemptRecovery(serverUrl);
      expect(first).toBe(true);

      // Second call within cooldown should return false immediately
      const second = await attemptRecovery(serverUrl);
      expect(second).toBe(false);
    } finally {
      resetConnection();
      await stopServer(server);
    }
  }, 15000);
});
