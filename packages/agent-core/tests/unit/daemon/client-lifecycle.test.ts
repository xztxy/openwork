import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DaemonRpcServer } from '../../../src/daemon/rpc-server.js';
import { DaemonClient } from '../../../src/daemon/client.js';
import { createSocketTransport } from '../../../src/daemon/socket-transport.js';

let tempDir: string;
let server: DaemonRpcServer | null = null;

function createTempSocketPath(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'daemon-lifecycle-test-'));
  return join(tempDir, 'test.sock');
}

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('DaemonClient offNotification', () => {
  it('removes a specific handler so it no longer fires', async () => {
    const socketPath = createTempSocketPath();
    server = new DaemonRpcServer({ socketPath });
    await server.start();

    const transport = await createSocketTransport({ socketPath });
    const client = new DaemonClient({ transport });
    await client.ping();

    const received: unknown[] = [];
    const handler = (data: unknown) => {
      received.push(data);
    };

    client.onNotification('task.progress' as never, handler);

    // Send first notification — should be received
    server.notify('task.progress', { taskId: 'tsk-1', stage: 'running' });
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(1);

    // Remove handler
    client.offNotification('task.progress' as never, handler);

    // Send second notification — should NOT be received
    server.notify('task.progress', { taskId: 'tsk-2', stage: 'done' });
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(1); // still 1, not 2

    client.close();
  });

  it('only removes the specific handler, not others on the same method', async () => {
    const socketPath = createTempSocketPath();
    server = new DaemonRpcServer({ socketPath });
    await server.start();

    const transport = await createSocketTransport({ socketPath });
    const client = new DaemonClient({ transport });
    await client.ping();

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const handlerA = (data: unknown) => receivedA.push(data);
    const handlerB = (data: unknown) => receivedB.push(data);

    client.onNotification('task.progress' as never, handlerA);
    client.onNotification('task.progress' as never, handlerB);

    // Remove only handlerA
    client.offNotification('task.progress' as never, handlerA);

    server.notify('task.progress', { taskId: 'tsk-1' });
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedA).toHaveLength(0); // removed
    expect(receivedB).toHaveLength(1); // still active

    client.close();
  });

  it('is a no-op for unregistered handlers', async () => {
    const socketPath = createTempSocketPath();
    server = new DaemonRpcServer({ socketPath });
    await server.start();

    const transport = await createSocketTransport({ socketPath });
    const client = new DaemonClient({ transport });

    // Should not throw
    client.offNotification('task.progress' as never, () => {});

    client.close();
  });
});

describe('DaemonClient.call per-call timeoutMs', () => {
  it('uses the client-wide default when no per-call override is given', async () => {
    const socketPath = createTempSocketPath();
    server = new DaemonRpcServer({ socketPath });
    server.registerMethod(
      'auth.openai.awaitCompletion' as never,
      (async () => {
        // Never resolve — simulates the daemon blocking on the OAuth flow.
        await new Promise(() => {});
      }) as never,
    );
    await server.start();

    const transport = await createSocketTransport({ socketPath });
    const client = new DaemonClient({ transport, timeout: 100 });

    const start = Date.now();
    await expect(
      client.call('auth.openai.awaitCompletion' as never, undefined as never),
    ).rejects.toThrow(/RPC timeout.*100ms/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(500);

    client.close();
  });

  it('per-call timeoutMs overrides the client-wide default — required for OAuth', async () => {
    // REGRESSION (manual OAuth test, post-Phase-4a): the desktop OAuth IPC
    // handler calls `auth.openai.awaitCompletion` which can legitimately
    // block for up to 2 minutes while the user finishes the browser flow.
    // The DaemonClient's default 30s timeout was firing first, surfacing
    // `RPC timeout: auth.openai.awaitCompletion (30000ms)` in the desktop
    // main log even though the daemon-side flow eventually succeeded.
    // Fix: let `call()` accept an `options.timeoutMs` per-call override.
    const socketPath = createTempSocketPath();
    server = new DaemonRpcServer({ socketPath });
    let resolveServerSide: (value: unknown) => void = () => {};
    server.registerMethod(
      'auth.openai.awaitCompletion' as never,
      (async () => {
        return new Promise((resolve) => {
          resolveServerSide = resolve;
        });
      }) as never,
    );
    await server.start();

    const transport = await createSocketTransport({ socketPath });
    // Aggressively low default to prove the per-call override actually
    // wins. If `options.timeoutMs` were ignored, this call would reject
    // at ~50ms with "RPC timeout: ...50ms".
    const client = new DaemonClient({ transport, timeout: 50 });

    const callPromise = client.call('auth.openai.awaitCompletion' as never, undefined as never, {
      timeoutMs: 5_000,
    });

    // Wait longer than the client-wide default — proves the per-call
    // timeout is in effect.
    await new Promise((r) => setTimeout(r, 200));

    // Now resolve the server-side handler. The call should succeed
    // because the per-call 5s budget hasn't expired.
    resolveServerSide({ ok: true, plan: 'paid' });
    await expect(callPromise).resolves.toEqual({ ok: true, plan: 'paid' });

    client.close();
  });
});
