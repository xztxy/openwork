/**
 * Task Scheduler
 *
 * Lightweight cron-based task scheduler for the daemon. Stores scheduled tasks
 * in memory and fires them via a DaemonClient `task.start` call.
 *
 * ESM module — use .js extensions on imports.
 */

import type { ScheduledTask } from '../common/types/daemon.js';
import { createLogger } from './logger.js';
import { matchesCron, getNextRunTime, validateCronExpression } from './scheduler-jobs.js';

export { parseCronField, matchesCron } from './scheduler-jobs.js';

const logger = createLogger('Scheduler');

type ScheduledTaskCallback = (task: ScheduledTask) => void;

const schedules = new Map<string, ScheduledTask>();
let timerId: ReturnType<typeof setInterval> | null = null;
let onFireCallback: ScheduledTaskCallback | null = null;

/**
 * Add a scheduled task. Returns the created ScheduledTask.
 */
export function addScheduledTask(cron: string, prompt: string): ScheduledTask {
  validateCronExpression(cron);

  const id = `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const task: ScheduledTask = {
    id,
    cron,
    prompt,
    enabled: true,
    createdAt: new Date().toISOString(),
    nextRunAt: getNextRunTime(cron),
  };

  schedules.set(id, task);
  logger.info('Added schedule:', id, cron, prompt.slice(0, 50));

  // Start the timer if not running
  if (!timerId) {
    startTimer();
  }

  return task;
}

/**
 * List all scheduled tasks.
 */
export function listScheduledTasks(): ScheduledTask[] {
  return Array.from(schedules.values());
}

/**
 * Cancel (remove) a scheduled task.
 */
export function cancelScheduledTask(scheduleId: string): boolean {
  const existed = schedules.has(scheduleId);
  schedules.delete(scheduleId);
  logger.info('Cancelled schedule:', scheduleId);

  if (schedules.size === 0 && timerId) {
    stopTimer();
  }
  return existed;
}

/**
 * Set the callback to invoke when a scheduled task fires.
 */
export function onScheduledTaskFire(callback: ScheduledTaskCallback): void {
  onFireCallback = callback;
}

/**
 * Stop the scheduler and clear all schedules.
 */
export function disposeScheduler(): void {
  stopTimer();
  schedules.clear();
  onFireCallback = null;
  logger.info('Disposed');
}

// ── Internal timer ───────────────────────────────────────────────────

function startTimer(): void {
  // Check every 60 seconds (aligned to minute boundaries)
  timerId = setInterval(() => {
    tick();
  }, 60_000);

  logger.info('Timer started');
}

function stopTimer(): void {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    logger.info('Timer stopped');
  }
}

function tick(): void {
  const now = new Date();

  for (const task of schedules.values()) {
    if (!task.enabled) {
      continue;
    }

    if (matchesCron(task.cron, now)) {
      logger.info('Firing scheduled task:', task.id, task.prompt.slice(0, 50));
      task.lastRunAt = now.toISOString();
      task.nextRunAt = getNextRunTime(task.cron);

      if (onFireCallback) {
        try {
          onFireCallback(task);
        } catch (err) {
          logger.error('Callback error for task', task.id, err);
        }
      }
    }
  }
}
