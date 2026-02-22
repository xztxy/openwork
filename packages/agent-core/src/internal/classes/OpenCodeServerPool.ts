import { spawn, type ChildProcess } from 'child_process';
import net from 'net';

export interface OpenCodeServerPoolOptions {
  minIdle?: number;
  maxTotal?: number;
  coldStartFallback?: boolean;
  startupTimeoutMs?: number;
  enabled?: boolean;
}

export type WindowsOpenCodeServerPoolOptions = OpenCodeServerPoolOptions;
export type DarwinOpenCodeServerPoolOptions = OpenCodeServerPoolOptions;

export interface OpenCodeServerLease {
  attachUrl: string;
  source: 'warm' | 'cold';
  release: () => void;
  retire: () => void;
}

export interface OpenCodeServerPoolRuntimeOptions {
  getCliCommand: () => { command: string; args: string[] };
  cwd: string;
  buildEnvironment: () => Promise<NodeJS.ProcessEnv>;
  onBeforeStart?: () => Promise<void>;
}

interface ResolvedPoolOptions {
  minIdle: number;
  maxTotal: number;
  coldStartFallback: boolean;
  startupTimeoutMs: number;
  enabled: boolean;
}

interface PooledServer {
  id: number;
  attachUrl: string;
  process: ChildProcess;
  state: 'starting' | 'idle' | 'in_use';
  alive: boolean;
}

const DEFAULT_POOL_OPTIONS: ResolvedPoolOptions = {
  minIdle: 1,
  maxTotal: 2,
  coldStartFallback: true,
  startupTimeoutMs: 60000,
  enabled: true,
};

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function resolveOptions(options?: OpenCodeServerPoolOptions): ResolvedPoolOptions {
  const minIdle = toPositiveInt(options?.minIdle, DEFAULT_POOL_OPTIONS.minIdle);
  const maxTotalInput = toPositiveInt(options?.maxTotal, DEFAULT_POOL_OPTIONS.maxTotal);
  const maxTotal = Math.max(maxTotalInput, minIdle);
  const startupTimeoutMs = toPositiveInt(
    options?.startupTimeoutMs,
    DEFAULT_POOL_OPTIONS.startupTimeoutMs,
  );
  const coldStartFallback =
    typeof options?.coldStartFallback === 'boolean'
      ? options.coldStartFallback
      : DEFAULT_POOL_OPTIONS.coldStartFallback;
  const enabled =
    typeof options?.enabled === 'boolean' ? options.enabled : DEFAULT_POOL_OPTIONS.enabled;

  return {
    minIdle,
    maxTotal,
    coldStartFallback,
    startupTimeoutMs,
    enabled,
  };
}

class OpenCodeServerPool {
  private servers: Map<number, PooledServer> = new Map();
  private serverStartupErrors: Map<number, Error> = new Map();
  private idleQueue: PooledServer[] = [];
  private warmingCount = 0;
  private nextServerId = 1;
  private disposed = false;
  private runtime: OpenCodeServerPoolRuntimeOptions;
  private options: ResolvedPoolOptions;
  private logPrefix: string;
  private warmupFailureStreak = 0;
  private warmupBackoffUntil = 0;
  private warmupRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    runtime: OpenCodeServerPoolRuntimeOptions,
    logPrefix: string,
    options?: OpenCodeServerPoolOptions,
  ) {
    this.runtime = runtime;
    this.logPrefix = logPrefix;
    this.options = resolveOptions(options);
    this.ensureMinIdle();
  }

  updateConfig(
    runtime: OpenCodeServerPoolRuntimeOptions,
    options?: OpenCodeServerPoolOptions,
  ): void {
    if (this.disposed) {
      return;
    }
    this.runtime = runtime;
    this.options = resolveOptions(options);
    this.ensureMinIdle();
  }

  async acquire(): Promise<OpenCodeServerLease | null> {
    if (this.disposed) {
      throw new Error(`${this.logPrefix} is disposed`);
    }
    if (!this.options.enabled) {
      return null;
    }

    this.pruneIdleServers();

    const warmServer = this.idleQueue.shift();
    if (warmServer && warmServer.alive) {
      warmServer.state = 'in_use';
      this.ensureMinIdle();
      return this.createLease(warmServer, 'warm');
    }

    try {
      const coldServer = await this.spawnServer('in_use');
      this.ensureMinIdle();
      return this.createLease(coldServer, 'cold');
    } catch (error) {
      if (!this.options.coldStartFallback) {
        throw error;
      }
      if (!(error instanceof Error) || !error.message.includes(`${this.logPrefix} at capacity`)) {
        console.warn(`[${this.logPrefix}] Falling back to direct CLI startup:`, error);
      }
      this.ensureMinIdle();
      return null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.warmupRetryTimer) {
      clearTimeout(this.warmupRetryTimer);
      this.warmupRetryTimer = null;
    }

    for (const server of Array.from(this.servers.values())) {
      this.killServer(server);
    }
    this.servers.clear();
    this.serverStartupErrors.clear();
    this.idleQueue = [];
    this.warmingCount = 0;
  }

  private createLease(server: PooledServer, source: 'warm' | 'cold'): OpenCodeServerLease {
    let released = false;

    return {
      attachUrl: server.attachUrl,
      source,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.releaseServer(server.id);
      },
      retire: () => {
        if (released) {
          return;
        }
        released = true;
        this.retireServer(server.id);
      },
    };
  }

  private releaseServer(serverId: number): void {
    const server = this.servers.get(serverId);
    if (!server || !server.alive) {
      return;
    }
    if (server.state === 'idle') {
      return;
    }

    server.state = 'idle';
    this.idleQueue.push(server);
    this.ensureMinIdle();
  }

  private retireServer(serverId: number): void {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }
    this.killServer(server);
    this.ensureMinIdle();
  }

  private pruneIdleServers(): void {
    this.idleQueue = this.idleQueue.filter((server) => {
      if (!server.alive) {
        return false;
      }
      const current = this.servers.get(server.id);
      return !!current && current.state === 'idle';
    });
  }

  private ensureMinIdle(): void {
    if (this.disposed || !this.options.enabled) {
      return;
    }

    while (this.shouldWarmAnotherServer()) {
      this.warmingCount++;
      void this.spawnServer('idle')
        .then(() => {
          this.warmupFailureStreak = 0;
          this.warmupBackoffUntil = 0;
        })
        .catch((error) => {
          if (this.disposed) {
            return;
          }
          this.warmupFailureStreak = Math.min(this.warmupFailureStreak + 1, 8);
          const backoffMs = Math.min(2 ** (this.warmupFailureStreak - 1) * 1000, 30000);
          this.warmupBackoffUntil = Date.now() + backoffMs;
          console.warn(
            `[${this.logPrefix}] Warm server startup failed. Retrying in ${backoffMs}ms:`,
            error,
          );
        })
        .finally(() => {
          this.warmingCount = Math.max(0, this.warmingCount - 1);
          if (!this.disposed && this.warmupBackoffUntil > Date.now()) {
            const retryDelay = this.warmupBackoffUntil - Date.now();
            if (this.warmupRetryTimer) {
              clearTimeout(this.warmupRetryTimer);
            }
            this.warmupRetryTimer = setTimeout(() => {
              this.warmupRetryTimer = null;
              if (!this.disposed) {
                this.ensureMinIdle();
              }
            }, retryDelay);
            return;
          }
          if (!this.disposed) {
            this.ensureMinIdle();
          }
        });
    }
  }

  private shouldWarmAnotherServer(): boolean {
    if (this.warmupBackoffUntil > Date.now()) {
      return false;
    }

    const idleCount = this.idleQueue.length + this.warmingCount;
    if (idleCount >= this.options.minIdle) {
      return false;
    }

    const totalCount = this.servers.size + this.warmingCount;
    return totalCount < this.options.maxTotal;
  }

  private async spawnServer(state: 'idle' | 'in_use'): Promise<PooledServer> {
    if (this.servers.size >= this.options.maxTotal) {
      throw new Error(`${this.logPrefix} at capacity (${this.options.maxTotal})`);
    }

    if (this.runtime.onBeforeStart) {
      await this.runtime.onBeforeStart();
    }

    const { command, args } = this.runtime.getCliCommand();
    const env = await this.runtime.buildEnvironment();
    const serverPort = await this.allocatePort();
    const serveArgs = [...args, 'serve', '--hostname', '127.0.0.1', '--port', String(serverPort)];
    const child = spawn(command, serveArgs, {
      cwd: this.runtime.cwd,
      env: this.buildSpawnEnv(env),
      stdio: 'ignore',
    });
    child.unref();

    const server: PooledServer = {
      id: this.nextServerId++,
      attachUrl: `http://127.0.0.1:${serverPort}`,
      process: child,
      state: state === 'idle' ? 'starting' : state,
      alive: true,
    };

    this.servers.set(server.id, server);
    child.on('error', (error) => {
      this.handleServerError(server.id, error);
    });
    child.on('exit', () => {
      this.handleServerExit(server.id);
    });

    try {
      await this.waitForServerReady(server);
      if (state === 'idle') {
        server.state = 'idle';
        this.idleQueue.push(server);
      }
      return server;
    } catch (error) {
      this.killServer(server);
      throw error;
    }
  }

  private buildSpawnEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const spawnEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        spawnEnv[key] = value;
      }
    }
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') {
        spawnEnv[key] = value;
      }
    }
    return spawnEnv;
  }

  private async waitForServerReady(server: PooledServer): Promise<void> {
    const timeoutAt = Date.now() + this.options.startupTimeoutMs;
    while (Date.now() < timeoutAt) {
      if (this.disposed) {
        throw new Error(`${this.logPrefix} disposed while waiting for server readiness`);
      }

      const current = this.servers.get(server.id);
      const startupError = this.serverStartupErrors.get(server.id);
      if (startupError) {
        this.serverStartupErrors.delete(server.id);
        throw new Error(`${this.logPrefix} server failed during startup: ${startupError.message}`);
      }
      if (!current || !current.alive) {
        throw new Error(`${this.logPrefix} server exited during startup`);
      }

      if (await this.pingServer(server.attachUrl)) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`${this.logPrefix} server startup timed out`);
  }

  private async pingServer(attachUrl: string): Promise<boolean> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 1000);

    try {
      const response = await fetch(attachUrl, {
        method: 'GET',
        signal: abortController.signal,
      });
      return response.status >= 200 && response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private handleServerExit(serverId: number): void {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }

    server.alive = false;
    this.servers.delete(serverId);
    this.serverStartupErrors.delete(serverId);
    this.idleQueue = this.idleQueue.filter((candidate) => candidate.id !== serverId);

    if (!this.disposed) {
      this.ensureMinIdle();
    }
  }

  private handleServerError(serverId: number, error: Error): void {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }

    this.serverStartupErrors.set(serverId, error);
    server.alive = false;
    this.servers.delete(serverId);
    this.idleQueue = this.idleQueue.filter((candidate) => candidate.id !== serverId);

    if (!this.disposed) {
      this.ensureMinIdle();
    }
  }

  private killServer(server: PooledServer): void {
    if (!server.alive) {
      return;
    }

    server.alive = false;
    this.servers.delete(server.id);
    this.serverStartupErrors.delete(server.id);
    this.idleQueue = this.idleQueue.filter((candidate) => candidate.id !== server.id);
    try {
      server.process.kill();
    } catch {
      // intentionally empty
    }
  }

  private allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.unref();
      probe.on('error', (error) => {
        reject(error);
      });
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        if (!address || typeof address === 'string') {
          probe.close(() => {
            reject(new Error(`${this.logPrefix} failed to allocate server port`));
          });
          return;
        }

        const port = address.port;
        probe.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
      });
    });
  }
}

let globalWindowsOpenCodeServerPool: OpenCodeServerPool | null = null;
let globalDarwinOpenCodeServerPool: OpenCodeServerPool | null = null;

export function getWindowsOpenCodeServerPool(
  runtime: OpenCodeServerPoolRuntimeOptions,
  options?: WindowsOpenCodeServerPoolOptions,
): OpenCodeServerPool {
  if (!globalWindowsOpenCodeServerPool) {
    globalWindowsOpenCodeServerPool = new OpenCodeServerPool(
      runtime,
      'WindowsOpenCodeServerPool',
      options,
    );
    return globalWindowsOpenCodeServerPool;
  }

  globalWindowsOpenCodeServerPool.updateConfig(runtime, options);
  return globalWindowsOpenCodeServerPool;
}

export function getDarwinOpenCodeServerPool(
  runtime: OpenCodeServerPoolRuntimeOptions,
  options?: DarwinOpenCodeServerPoolOptions,
): OpenCodeServerPool {
  if (!globalDarwinOpenCodeServerPool) {
    globalDarwinOpenCodeServerPool = new OpenCodeServerPool(
      runtime,
      'DarwinOpenCodeServerPool',
      options,
    );
    return globalDarwinOpenCodeServerPool;
  }

  globalDarwinOpenCodeServerPool.updateConfig(runtime, options);
  return globalDarwinOpenCodeServerPool;
}

export function disposeWindowsOpenCodeServerPool(): void {
  if (!globalWindowsOpenCodeServerPool) {
    return;
  }
  globalWindowsOpenCodeServerPool.dispose();
  globalWindowsOpenCodeServerPool = null;
}

export function disposeDarwinOpenCodeServerPool(): void {
  if (!globalDarwinOpenCodeServerPool) {
    return;
  }
  globalDarwinOpenCodeServerPool.dispose();
  globalDarwinOpenCodeServerPool = null;
}
