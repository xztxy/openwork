/**
 * End-to-end smoke for the SDK cutover.
 *
 *   pnpm exec tsx apps/daemon/__scratch__/e2e-smoke.ts
 *
 * Spins up the OSS daemon against an isolated `--data-dir`, connects to its
 * RPC socket, subscribes to task events, and starts a task with a trivial
 * prompt. The point is NOT to verify that the agent produces the right answer
 * (that depends on the user's configured LLM provider). The point is to
 * verify the full SDK pipeline — daemon → server-manager → opencode serve →
 * SDK adapter → event subscription → task lifecycle events back through RPC —
 * actually executes end to end without throwing.
 *
 * Pass criteria:
 *   1. Daemon boots and opens its Unix socket.
 *   2. RPC client connects.
 *   3. `task.start` resolves (does NOT throw "no opencode serve URL" or
 *      "method does not exist" or a Zod shape mismatch).
 *   4. We see `task.message` and/or `task.status` notifications stream back.
 *   5. Daemon process is killed cleanly at the end.
 *
 * If no LLM provider is configured in the isolated data dir, the task will
 * still pass the SDK pipeline and then fail with a structured error. That's
 * expected and counts as PASS for the pipeline check.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

interface SmokeResult {
  daemonBooted: boolean;
  rpcConnected: boolean;
  taskStarted: boolean;
  startedTaskId: string | null;
  notificationsSeen: Set<string>;
  errors: string[];
}

const result: SmokeResult = {
  daemonBooted: false,
  rpcConnected: false,
  taskStarted: false,
  startedTaskId: null,
  notificationsSeen: new Set(),
  errors: [],
};

let daemon: ChildProcess | null = null;
let dataDir: string | null = null;

async function spawnDaemon(): Promise<{ proc: ChildProcess; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'accomplish-smoke-'));
  mkdirSync(dataDir, { recursive: true });

  console.log(`[smoke] data-dir: ${dataDir}`);

  // The production daemon ships as a bundled CJS file (tsup output). That's
  // what gets run in dev (`pnpm dev` → desktop spawns daemon dist/index.js)
  // and in packaged builds. Run the same path here. Direct tsx invocation
  // hits an ESM/CJS exports-condition mismatch in `@opencode-ai/sdk@1.2.24`
  // (the SDK only declares an `import` condition for `./v2`; tsx invokes
  // CJS resolution), so the spike must build first.
  console.log(`[smoke] building daemon (pnpm -F @accomplish/daemon build) ...`);
  const buildProc = spawn('pnpm', ['-F', '@accomplish/daemon', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  await new Promise<void>((resolve, reject) => {
    buildProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`daemon build failed with code ${code}`));
    });
  });

  console.log(`[smoke] spawning bundled daemon (node apps/daemon/dist/index.js)`);
  const proc = spawn(
    'node',
    [
      join(REPO_ROOT, 'apps/daemon/dist/index.js'),
      '--data-dir',
      dataDir,
      // Tell the daemon where the app root is so its `resolveCliPath` can
      // find the bundled `opencode-ai/bin/opencode`. The packaged Electron
      // app would set these via `--packaged --resources-path … --app-path …`
      // arguments. In dev, the opencode CLI lives at
      // `apps/desktop/node_modules/.bin/opencode`, so we point app-path
      // there. (`server-manager.ts` separately uses `require.resolve` to
      // find the CLI for spawning `opencode serve` — that's independent of
      // this CLI-availability check.)
      '--app-path',
      join(REPO_ROOT, 'apps/desktop'),
      '--resources-path',
      REPO_ROOT,
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Use isolated XDG so the smoke never touches the user's real
        // opencode auth.json.
        XDG_DATA_HOME: join(dataDir, 'xdg', 'data'),
        XDG_CONFIG_HOME: join(dataDir, 'xdg', 'config'),
        XDG_STATE_HOME: join(dataDir, 'xdg', 'state'),
        XDG_CACHE_HOME: join(dataDir, 'xdg', 'cache'),
      },
    },
  );

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trimEnd();
    if (text) console.log(`[daemon stdout] ${text}`);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trimEnd();
    if (text) console.error(`[daemon stderr] ${text}`);
  });

  return { proc, dataDir };
}

async function waitForSocket(socketPath: string, timeoutMs = 30_000): Promise<void> {
  const fs = await import('node:fs');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(socketPath)) return;
    } catch {
      /* keep trying */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`socket ${socketPath} did not appear within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  // 1. Boot the daemon
  const spawned = await spawnDaemon();
  daemon = spawned.proc;
  dataDir = spawned.dataDir;

  // 2. Resolve the socket path the daemon will open. `getSocketPath(dataDir)`
  // in agent-core puts it directly in the data dir (not under XDG).
  const socketPath = join(dataDir, 'daemon.sock');

  try {
    await waitForSocket(socketPath, 30_000);
    result.daemonBooted = true;
    console.log(`[smoke] daemon socket appeared: ${socketPath}`);
  } catch (err) {
    result.errors.push(`daemon never opened socket: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // 3. Connect via DaemonClient. Use the agent-core surface so we exercise
  // the same code path as the desktop main process. The socket transport
  // has its own factory because it needs to connect-then-attach.
  const agentCore = await import('@accomplish_ai/agent-core');
  const DaemonClient = agentCore.DaemonClient;
  const createSocketTransport = (
    agentCore as unknown as {
      createSocketTransport: (opts: {
        socketPath: string;
      }) => Promise<{ onMessage: (cb: unknown) => void; send: (msg: unknown) => void }>;
    }
  ).createSocketTransport;

  let client: InstanceType<typeof DaemonClient>;
  try {
    const transport = await createSocketTransport({ socketPath });
    client = new DaemonClient({ transport: transport as never });
    result.rpcConnected = true;
    console.log('[smoke] RPC client connected');
  } catch (err) {
    result.errors.push(`RPC connect failed: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // 4. Subscribe to task notifications BEFORE starting the task so we don't
  // miss early events.
  const notificationsToWatch = [
    'task.message',
    'task.status',
    'task.complete',
    'task.error',
    'task.progress',
    'permission.request',
  ];
  const onNotification = (
    client as unknown as {
      onNotification: (m: string, cb: (p: unknown) => void) => void;
    }
  ).onNotification.bind(client);
  for (const method of notificationsToWatch) {
    onNotification(method, (payload) => {
      if (!result.notificationsSeen.has(method)) {
        console.log(
          `[smoke] first notification ${method}: ${JSON.stringify(payload).slice(0, 200)}`,
        );
      }
      result.notificationsSeen.add(method);
    });
  }

  // 5. Start the task.
  try {
    const task = await client.call('task.start', {
      prompt: 'Smoke test: respond with the literal string "OK".',
    } as never);
    result.taskStarted = true;
    result.startedTaskId = (task as { id?: string } | null | undefined)?.id ?? null;
    console.log(`[smoke] task.start resolved: id=${result.startedTaskId}`);
  } catch (err) {
    result.errors.push(`task.start threw: ${err instanceof Error ? err.message : err}`);
  }

  // 6. Wait briefly for at least one event notification.
  await new Promise((r) => setTimeout(r, 5_000));

  // 7. Tear the task down so the smoke doesn't leave a runtime running.
  if (result.startedTaskId) {
    try {
      await client.call('task.cancel', { taskId: result.startedTaskId } as never);
      console.log('[smoke] task.cancel succeeded');
    } catch (err) {
      console.log(`[smoke] task.cancel: ${err instanceof Error ? err.message : err}`);
    }
  }

  // No explicit client.disconnect — the transport is owned by the smoke and
  // its socket gets closed when the daemon is killed in shutdown().
}

async function shutdown(): Promise<void> {
  if (daemon) {
    console.log(`[smoke] killing daemon pid=${daemon.pid}`);
    daemon.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    try {
      if (daemon.pid !== undefined) process.kill(daemon.pid, 0);
      console.log('[smoke] daemon still alive — escalating to SIGKILL');
      daemon.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main()
  .catch((err) => {
    result.errors.push(`outer: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  })
  .finally(async () => {
    await shutdown();
    console.log('\n──────────────────────── SMOKE SUMMARY ────────────────────────');
    console.log(`  daemonBooted:    ${result.daemonBooted ? 'PASS' : 'FAIL'}`);
    console.log(`  rpcConnected:    ${result.rpcConnected ? 'PASS' : 'FAIL'}`);
    console.log(`  taskStarted:     ${result.taskStarted ? 'PASS' : 'FAIL'}`);
    console.log(
      `  notifications:   ${
        result.notificationsSeen.size > 0
          ? [...result.notificationsSeen].join(', ')
          : '(none seen — check daemon logs)'
      }`,
    );
    if (result.errors.length > 0) {
      console.log('  ERRORS:');
      for (const e of result.errors) console.log(`    - ${e}`);
    }
    console.log('───────────────────────────────────────────────────────────────');
    const hardFail = !result.daemonBooted || !result.rpcConnected;
    process.exit(hardFail ? 1 : 0);
  });
