export interface TaskInactivityWatchdogSnapshot {
  fingerprint: string;
  inProgress: boolean;
  summary?: string;
}

export interface TaskInactivityWatchdogTimeoutContext {
  elapsedMs: number;
  attempt: number;
  snapshot: TaskInactivityWatchdogSnapshot;
}

export interface TaskInactivityWatchdogOptions {
  sample: () => Promise<TaskInactivityWatchdogSnapshot>;
  onSoftTimeout: (context: TaskInactivityWatchdogTimeoutContext) => Promise<void> | void;
  onHardTimeout: (context: TaskInactivityWatchdogTimeoutContext) => Promise<void> | void;
  onDebug?: (type: string, message: string, data?: unknown) => void;
  sampleIntervalMs?: number;
  stallTimeoutMs?: number;
  postNudgeTimeoutMs?: number;
  maxSoftTimeouts?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;
const DEFAULT_STALL_TIMEOUT_MS = 90_000;
const DEFAULT_POST_NUDGE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_SOFT_TIMEOUTS = 1;

export class TaskInactivityWatchdog {
  private readonly sample: () => Promise<TaskInactivityWatchdogSnapshot>;
  private readonly onSoftTimeout: (
    context: TaskInactivityWatchdogTimeoutContext,
  ) => Promise<void> | void;
  private readonly onHardTimeout: (
    context: TaskInactivityWatchdogTimeoutContext,
  ) => Promise<void> | void;
  private readonly onDebug?: (type: string, message: string, data?: unknown) => void;
  private readonly sampleIntervalMs: number;
  private readonly stallTimeoutMs: number;
  private readonly postNudgeTimeoutMs: number;
  private readonly maxSoftTimeouts: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: boolean = false;
  private lastFingerprint: string | null = null;
  private lastChangedAtMs: number | null = null;
  private softTimeoutCount: number = 0;

  constructor(options: TaskInactivityWatchdogOptions) {
    this.sample = options.sample;
    this.onSoftTimeout = options.onSoftTimeout;
    this.onHardTimeout = options.onHardTimeout;
    this.onDebug = options.onDebug;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.postNudgeTimeoutMs = options.postNudgeTimeoutMs ?? DEFAULT_POST_NUDGE_TIMEOUT_MS;
    this.maxSoftTimeouts = options.maxSoftTimeouts ?? DEFAULT_MAX_SOFT_TIMEOUTS;
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  start(): void {
    this.stop();
    this.running = true;
    this.lastChangedAtMs = this.now();
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    this.lastFingerprint = null;
    this.lastChangedAtMs = null;
    this.softTimeoutCount = 0;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }

    this.clearTimeoutFn(this.timer);
    this.timer = null;
  }

  private scheduleNextTick(): void {
    if (!this.running || this.timer) {
      return;
    }

    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      void this.tick();
    }, this.sampleIntervalMs);
  }

  private resetProgress(snapshot: TaskInactivityWatchdogSnapshot, now: number): void {
    this.lastFingerprint = snapshot.fingerprint;
    this.lastChangedAtMs = now;
    this.softTimeoutCount = 0;
  }

  private getTimeoutThresholdMs(): number {
    if (this.softTimeoutCount < this.maxSoftTimeouts) {
      return this.stallTimeoutMs;
    }

    return this.postNudgeTimeoutMs;
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const snapshot = await this.sample();
      if (!this.running) {
        return;
      }

      const now = this.now();
      if (!snapshot.inProgress) {
        this.resetProgress(snapshot, now);
        return;
      }

      if (this.lastFingerprint === null || snapshot.fingerprint !== this.lastFingerprint) {
        this.resetProgress(snapshot, now);
        return;
      }

      const lastChangedAtMs = this.lastChangedAtMs ?? now;
      const elapsedMs = now - lastChangedAtMs;
      const thresholdMs = this.getTimeoutThresholdMs();
      if (elapsedMs < thresholdMs) {
        return;
      }

      if (this.softTimeoutCount < this.maxSoftTimeouts) {
        this.softTimeoutCount += 1;
        this.lastChangedAtMs = now;
        await this.onSoftTimeout({
          elapsedMs,
          attempt: this.softTimeoutCount,
          snapshot,
        });
        return;
      }

      await this.onHardTimeout({
        elapsedMs,
        attempt: this.softTimeoutCount,
        snapshot,
      });
      this.stop();
      return;
    } catch (error) {
      this.onDebug?.(
        'watchdog_sample_error',
        'Task inactivity watchdog sample failed',
        error instanceof Error ? { name: error.name, message: error.message } : error,
      );
    } finally {
      this.scheduleNextTick();
    }
  }
}
