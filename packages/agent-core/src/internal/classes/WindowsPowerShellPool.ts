import * as pty from 'node-pty';
import { getExtendedNodePath } from '../../utils/system-path.js';

export interface WindowsPowerShellPoolOptions {
  minIdle?: number;
  maxTotal?: number;
  coldStartFallback?: boolean;
}

export interface DarwinPowerShellPoolOptions {
  minIdle?: number;
  maxTotal?: number;
  coldStartFallback?: boolean;
}

interface PowerShellPoolLease {
  pty: pty.IPty;
  source: 'warm' | 'cold';
  retire: () => void;
}

export type WindowsPowerShellLease = PowerShellPoolLease;
export type DarwinPowerShellLease = PowerShellPoolLease;

interface PoolWorker {
  id: number;
  pty: pty.IPty;
  state: 'idle' | 'in_use';
  alive: boolean;
}

interface ResolvedPoolOptions {
  minIdle: number;
  maxTotal: number;
  coldStartFallback: boolean;
}

const DEFAULT_POOL_OPTIONS: ResolvedPoolOptions = {
  minIdle: 1,
  maxTotal: 11,
  coldStartFallback: true,
};

type PoolOptions = WindowsPowerShellPoolOptions | DarwinPowerShellPoolOptions;
type PowerShellExecutable = 'powershell.exe' | 'pwsh';

class PoolCapacityError extends Error {
  constructor(maxTotal: number) {
    super(`PowerShell pool at capacity (${maxTotal}). Cannot spawn additional workers.`);
    this.name = 'PoolCapacityError';
  }
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

function resolveOptions(options?: PoolOptions): ResolvedPoolOptions {
  const minIdle = toNonNegativeInt(options?.minIdle, DEFAULT_POOL_OPTIONS.minIdle);
  const maxTotalInput = toPositiveInt(options?.maxTotal, DEFAULT_POOL_OPTIONS.maxTotal);
  const maxTotal = Math.max(maxTotalInput, minIdle || 1);
  const coldStartFallback =
    typeof options?.coldStartFallback === 'boolean'
      ? options.coldStartFallback
      : DEFAULT_POOL_OPTIONS.coldStartFallback;

  return {
    minIdle,
    maxTotal,
    coldStartFallback,
  };
}

class PowerShellPool {
  private workers: Map<number, PoolWorker> = new Map();
  private idleQueue: PoolWorker[] = [];
  private warmingCount = 0;
  private nextWorkerId = 1;
  private disposed = false;
  private options: ResolvedPoolOptions;
  private tempPath: string;
  private executable: PowerShellExecutable;
  private logPrefix: string;
  private warmupFailureStreak = 0;
  private warmupBackoffUntil = 0;

  constructor(
    tempPath: string,
    executable: PowerShellExecutable,
    logPrefix: string,
    options?: PoolOptions,
  ) {
    this.tempPath = tempPath;
    this.executable = executable;
    this.logPrefix = logPrefix;
    this.options = resolveOptions(options);
    this.ensureMinIdle();
  }

  updateConfig(tempPath: string, options?: PoolOptions): void {
    if (this.disposed) return;
    this.tempPath = tempPath;
    this.options = resolveOptions(options);
    this.ensureMinIdle();
  }

  async acquire(): Promise<WindowsPowerShellLease> {
    if (this.disposed) {
      throw new Error(`${this.logPrefix} pool is disposed`);
    }

    this.pruneIdleWorkers();

    const warmWorker = this.idleQueue.shift();
    if (warmWorker && warmWorker.alive) {
      warmWorker.state = 'in_use';
      this.ensureMinIdle();
      return this.createLease(warmWorker, 'warm');
    }

    try {
      const coldWorker = await this.spawnWorker('in_use');
      this.ensureMinIdle();
      return this.createLease(coldWorker, 'cold');
    } catch (error) {
      if (error instanceof PoolCapacityError) {
        throw error;
      }
      if (!this.options.coldStartFallback) {
        throw error;
      }
      const fallbackWorker = await this.spawnWorker('in_use');
      this.ensureMinIdle();
      return this.createLease(fallbackWorker, 'cold');
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const worker of this.workers.values()) {
      try {
        worker.pty.kill();
      } catch {
        // intentionally empty
      }
    }
    this.workers.clear();
    this.idleQueue = [];
    this.warmingCount = 0;
  }

  private createLease(worker: PoolWorker, source: 'warm' | 'cold'): WindowsPowerShellLease {
    return {
      pty: worker.pty,
      source,
      retire: () => this.retireWorker(worker.id),
    };
  }

  private pruneIdleWorkers(): void {
    this.idleQueue = this.idleQueue.filter((worker) => worker.alive);
  }

  private ensureMinIdle(): void {
    if (this.disposed) return;

    while (this.shouldWarmAnotherWorker()) {
      this.warmingCount++;
      void this.spawnWorker('idle')
        .then(() => {
          this.warmupFailureStreak = 0;
          this.warmupBackoffUntil = 0;
        })
        .catch((error) => {
          this.warmupFailureStreak = Math.min(this.warmupFailureStreak + 1, 8);
          const backoffMs = Math.min(2 ** (this.warmupFailureStreak - 1) * 1000, 30000);
          this.warmupBackoffUntil = Date.now() + backoffMs;
          console.warn(`[${this.logPrefix}] Warm-up failed. Retrying in ${backoffMs}ms:`, error);
        })
        .finally(() => {
          this.warmingCount = Math.max(0, this.warmingCount - 1);
          if (!this.disposed && this.warmupBackoffUntil > Date.now()) {
            const retryDelay = this.warmupBackoffUntil - Date.now();
            setTimeout(() => {
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

  private shouldWarmAnotherWorker(): boolean {
    if (this.warmupBackoffUntil > Date.now()) return false;

    const idleCount = this.idleQueue.length + this.warmingCount;
    if (idleCount >= this.options.minIdle) return false;
    const totalCount = this.workers.size + this.warmingCount;
    return totalCount < this.options.maxTotal;
  }

  private async spawnWorker(state: 'idle' | 'in_use'): Promise<PoolWorker> {
    if (this.workers.size >= this.options.maxTotal) {
      throw new PoolCapacityError(this.options.maxTotal);
    }

    const env = this.buildWorkerEnv();

    const workerPty = pty.spawn(this.executable, ['-NoLogo', '-NoProfile', '-NoExit'], {
      name: 'xterm-256color',
      cols: 32000,
      rows: 30,
      cwd: this.tempPath,
      env,
    });

    const worker: PoolWorker = {
      id: this.nextWorkerId++,
      pty: workerPty,
      state,
      alive: true,
    };

    this.workers.set(worker.id, worker);
    if (state === 'idle') {
      this.idleQueue.push(worker);
    }

    workerPty.onExit(() => {
      this.handleWorkerExit(worker.id);
    });

    await this.waitForWorkerReady(worker);
    return worker;
  }

  private buildWorkerEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }

    if (this.executable === 'pwsh' && process.platform === 'darwin') {
      // GUI-launched Electron apps often have a minimal PATH; mirror desktop preflight lookup.
      const basePath = env.PATH ?? process.env.PATH ?? '';
      env.PATH = getExtendedNodePath(basePath);
    }

    return env;
  }

  private waitForWorkerReady(worker: PoolWorker): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const exitDisposable = worker.pty.onExit(({ exitCode, signal }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        exitDisposable.dispose();
        reject(
          new Error(
            `${this.logPrefix} worker exited during warm-up (id=${worker.id}, code=${exitCode}, signal=${signal}).`,
          ),
        );
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        exitDisposable.dispose();
        resolve();
      }, 75);
    });
  }

  private handleWorkerExit(workerId: number): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.alive = false;
    this.workers.delete(workerId);
    this.idleQueue = this.idleQueue.filter((item) => item.id !== workerId);

    if (!this.disposed) {
      this.ensureMinIdle();
    }
  }

  private retireWorker(workerId: number): void {
    const worker = this.workers.get(workerId);
    if (!worker || !worker.alive) return;

    try {
      worker.pty.write('exit\r');
    } catch {
      // intentionally empty
    }

    setTimeout(() => {
      if (!worker.alive) return;
      try {
        worker.pty.kill();
      } catch {
        // intentionally empty
      }
    }, 100);
  }
}

let globalWindowsPool: PowerShellPool | null = null;
let globalDarwinPool: PowerShellPool | null = null;

export function getWindowsPowerShellPool(
  tempPath: string,
  options?: WindowsPowerShellPoolOptions,
): PowerShellPool {
  if (!globalWindowsPool) {
    globalWindowsPool = new PowerShellPool(
      tempPath,
      'powershell.exe',
      'WindowsPowerShellPool',
      options,
    );
    return globalWindowsPool;
  }

  globalWindowsPool.updateConfig(tempPath, options);
  return globalWindowsPool;
}

export function getDarwinPowerShellPool(
  tempPath: string,
  options?: DarwinPowerShellPoolOptions,
): PowerShellPool {
  if (!globalDarwinPool) {
    globalDarwinPool = new PowerShellPool(tempPath, 'pwsh', 'DarwinPowerShellPool', options);
    return globalDarwinPool;
  }

  globalDarwinPool.updateConfig(tempPath, options);
  return globalDarwinPool;
}

export function disposeWindowsPowerShellPool(): void {
  if (!globalWindowsPool) return;
  globalWindowsPool.dispose();
  globalWindowsPool = null;
}

export function disposeDarwinPowerShellPool(): void {
  if (!globalDarwinPool) return;
  globalDarwinPool.dispose();
  globalDarwinPool = null;
}
