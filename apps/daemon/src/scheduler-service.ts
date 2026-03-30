/**
 * Scheduler Service
 *
 * Ticks every 60 seconds, checks for enabled scheduled tasks whose
 * next_run_at has passed, fires their prompts via the onTaskFire callback,
 * and updates the database with last_run_at / next_run_at.
 */

import type { StorageAPI, ScheduledTask } from '@accomplish_ai/agent-core';

// =============================================================================
// Cron Parsing & Matching
// =============================================================================

/**
 * Parse a single cron field (e.g. "1,5,10", "1-5", "star/10", "*") into an
 * array of matching integer values within [min, max].
 */
function parseCronField(field: string, min: number, max: number): number[] | null {
  const values: number[] = [];

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    if (trimmed === '*') {
      for (let i = min; i <= max; i++) {
        values.push(i);
      }
      continue;
    }

    const stepMatch = trimmed.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      if (step <= 0) {
        return null;
      }
      for (let i = min; i <= max; i += step) {
        values.push(i);
      }
      continue;
    }

    const rangeMatch = trimmed.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1;
      if (start < min || end > max || start > end || step <= 0) {
        return null;
      }
      for (let i = start; i <= end; i += step) {
        values.push(i);
      }
      continue;
    }

    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < min || num > max) {
      return null;
    }
    values.push(num);
  }

  return values.length > 0 ? [...new Set(values)].sort((a, b) => a - b) : null;
}

/** Check whether a cron expression matches a given Date. */
function matchesCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }

  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const doms = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const dows = parseCronField(fields[4], 0, 6);

  if (!minutes || !hours || !doms || !months || !dows) {
    return false;
  }

  return (
    minutes.includes(date.getMinutes()) &&
    hours.includes(date.getHours()) &&
    doms.includes(date.getDate()) &&
    months.includes(date.getMonth() + 1) &&
    dows.includes(date.getDay())
  );
}

/**
 * Compute the next time a cron expression will fire, starting from `from`.
 * Scans minute-by-minute up to 7 days. Returns ISO string or null.
 */
function computeNextRunAt(cron: string, from: Date): string | null {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxTime = from.getTime() + 7 * 24 * 60 * 60 * 1000;

  while (candidate.getTime() <= maxTime) {
    if (matchesCron(cron, candidate)) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

/** Validate that a string is a well-formed 5-field cron expression. */
function validateCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }

  const limits: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];

  return fields.every((field, i) => parseCronField(field, limits[i][0], limits[i][1]) !== null);
}

// =============================================================================
// SchedulerService
// =============================================================================

export class SchedulerService {
  private storage: StorageAPI;
  private onTaskFire: (prompt: string, workspaceId?: string) => void;
  private alignTimeout: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(storage: StorageAPI, onTaskFire: (prompt: string, workspaceId?: string) => void) {
    this.storage = storage;
    this.onTaskFire = onTaskFire;
  }

  /**
   * Start the scheduler. Fires overdue schedules immediately (catch-up),
   * then aligns to the next minute boundary and ticks every 60 seconds.
   */
  start(): void {
    this.catchUp();

    // Align to the next minute boundary
    const now = Date.now();
    const msUntilNextMinute = 60_000 - (now % 60_000);

    this.alignTimeout = setTimeout(() => {
      this.tick();
      this.tickInterval = setInterval(() => this.tick(), 60_000);
    }, msUntilNextMinute);
  }

  /** Stop all timers. */
  stop(): void {
    if (this.alignTimeout) {
      clearTimeout(this.alignTimeout);
      this.alignTimeout = null;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Tick: find enabled schedules whose next_run_at <= now, update their
   * last_run_at and next_run_at, then fire their prompts.
   */
  tick(): void {
    const now = new Date();
    const nowIso = now.toISOString();

    const enabled = this.storage.getEnabledScheduledTasks();
    const due = enabled.filter((t) => t.nextRunAt && t.nextRunAt <= nowIso);

    for (const task of due) {
      const next = computeNextRunAt(task.cron, now) || nowIso;
      this.storage.updateScheduledTaskLastRun(task.id, nowIso, next);
      try {
        this.onTaskFire(task.prompt, task.workspaceId);
      } catch (err) {
        console.error(`[Scheduler] Error firing task ${task.id}:`, err);
      }
    }
  }

  /**
   * Fire once for any overdue schedules (e.g. daemon was stopped).
   * Only fires schedules whose next_run_at is in the past.
   */
  catchUp(): void {
    const now = new Date();
    const nowIso = now.toISOString();

    const enabled = this.storage.getEnabledScheduledTasks();
    const overdue = enabled.filter((t) => t.nextRunAt && t.nextRunAt < nowIso);

    for (const task of overdue) {
      const next = computeNextRunAt(task.cron, now) || nowIso;
      this.storage.updateScheduledTaskLastRun(task.id, nowIso, next);
      try {
        this.onTaskFire(task.prompt, task.workspaceId);
      } catch (err) {
        console.error(`[Scheduler] Error during catch-up for task ${task.id}:`, err);
      }
    }
  }

  /** Create a new schedule after validating the cron expression. */
  createSchedule(cron: string, prompt: string, workspaceId?: string): ScheduledTask {
    if (!validateCron(cron)) {
      throw new Error(`Invalid cron expression: ${cron}`);
    }
    return this.storage.createScheduledTask(cron, prompt, workspaceId);
  }

  /** List all schedules, optionally filtered by workspace. */
  listSchedules(workspaceId?: string): ScheduledTask[] {
    if (workspaceId) {
      return this.storage.getScheduledTasksByWorkspace(workspaceId);
    }
    return this.storage.getAllScheduledTasks();
  }

  /** Delete a schedule by ID. */
  deleteSchedule(id: string): void {
    this.storage.deleteScheduledTask(id);
  }

  /** Enable or disable a schedule. */
  setEnabled(id: string, enabled: boolean): void {
    this.storage.setScheduledTaskEnabled(id, enabled);
  }
}
