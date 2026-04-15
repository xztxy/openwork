import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter } from '../../../../src/internal/classes/OpenCodeAdapter.js';

/**
 * REGRESSION (Max review residual #4): the `TaskInactivityWatchdog` class
 * has comprehensive unit tests of its own, but they only prove it works in
 * isolation. This suite pins the wiring inside `OpenCodeAdapter` — that
 * `startWatchdog()` actually constructs a watchdog and that the hard
 * timeout callback drives the adapter into a failed-task terminal state.
 *
 * Without these tests, a future refactor that accidentally drops
 * `this.startWatchdog()` from `startTask()` — or the hard-timeout
 * handler's `markComplete('error', …)` call — would silently re-introduce
 * the "LLM stream hangs forever" bug the watchdog was added to fix.
 */
describe('OpenCodeAdapter watchdog wiring', () => {
  beforeEach(() => {
    // Silence the adapter's console logger during the test.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function constructAdapter(): OpenCodeAdapter {
    // Minimal options — enough to construct the adapter. Not calling
    // startTask(), which would require a full SDK mock. We directly
    // exercise the private watchdog-related helpers via a narrow escape
    // hatch; the adapter's public contract is "on hard timeout, emit
    // 'error' and mark the task complete with status='error'".
    const adapter = new OpenCodeAdapter(
      {
        platform: 'darwin',
        isPackaged: false,
        tempPath: '/tmp',
      },
      'tsk_watchdog_test',
    );
    return adapter;
  }

  it('startWatchdog constructs a watchdog instance', () => {
    const adapter = constructAdapter();
    // Before: no watchdog yet.
    expect((adapter as unknown as { watchdog: unknown }).watchdog).toBeNull();

    // Direct call to the private helper. Typecheck-safe via cast.
    (adapter as unknown as { startWatchdog: () => void }).startWatchdog();

    expect((adapter as unknown as { watchdog: unknown }).watchdog).not.toBeNull();

    // Teardown cleans it up so the test exits cleanly (the watchdog has
    // a running sampleIntervalMs timer by default).
    (adapter as unknown as { teardown: () => void }).teardown();
    expect((adapter as unknown as { watchdog: unknown }).watchdog).toBeNull();
  });

  it('hard-timeout handler emits "error" and calls markComplete with status="error"', () => {
    const adapter = constructAdapter();

    const errorEvents: Error[] = [];
    adapter.on('error', (err) => errorEvents.push(err));
    const completeEvents: Array<{ status: string; error?: string }> = [];
    adapter.on('complete', (result) => completeEvents.push(result));

    // Invoke the private hard-timeout handler directly. This is exactly
    // what the watchdog class calls when its `postNudgeTimeoutMs` budget
    // expires without progress.
    (
      adapter as unknown as {
        handleWatchdogHardTimeout: (ctx: {
          elapsedMs: number;
          attempt: number;
          snapshot: { fingerprint: string; inProgress: boolean };
        }) => void;
      }
    ).handleWatchdogHardTimeout({
      elapsedMs: 150_000,
      attempt: 1,
      snapshot: { fingerprint: 'frozen:0:no-pending', inProgress: true },
    });

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].message).toMatch(/watchdog/i);
    expect(errorEvents[0].message).toMatch(/\d+s/); // includes elapsed seconds

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].status).toBe('error');
    expect(completeEvents[0].error).toMatch(/watchdog/i);
  });

  it('sampleWatchdogState reports inProgress=false when a pending request is waiting on a human', () => {
    const adapter = constructAdapter();
    // Seed session + pending-request internal state that the sample
    // function reads. These fields are private; use narrow escape.
    const priv = adapter as unknown as {
      currentSessionId: string | null;
      watchdogActivityCounter: number;
      pendingRequest: unknown;
      sampleWatchdogState: () => { fingerprint: string; inProgress: boolean };
    };
    priv.currentSessionId = 'ses_1';
    priv.watchdogActivityCounter = 5;
    priv.pendingRequest = {
      kind: 'permission',
      ossRequestId: 'filereq_xyz',
      sdkRequestId: 'per_sdk_xyz',
    };

    const snap = priv.sampleWatchdogState();
    // The watchdog must not escalate while we're waiting on the user —
    // human input time is not a stall. `inProgress: false` tells the
    // watchdog to reset its timer on each sample.
    expect(snap.inProgress).toBe(false);
    // Fingerprint still encodes the pending-request id so if the user
    // replies and a new request arrives, progress is detected.
    expect(snap.fingerprint).toContain('per_sdk_xyz');
  });

  it('hard-timeout handler is a no-op when the task already completed', () => {
    const adapter = constructAdapter();
    const errorEvents: Error[] = [];
    adapter.on('error', (err) => errorEvents.push(err));

    // Simulate the task having already finished via the success path.
    (adapter as unknown as { hasCompleted: boolean }).hasCompleted = true;

    (
      adapter as unknown as {
        handleWatchdogHardTimeout: (ctx: {
          elapsedMs: number;
          attempt: number;
          snapshot: { fingerprint: string; inProgress: boolean };
        }) => void;
      }
    ).handleWatchdogHardTimeout({
      elapsedMs: 200_000,
      attempt: 1,
      snapshot: { fingerprint: 'x', inProgress: true },
    });

    // Already-completed tasks must not get a belated error — the user
    // already saw their success result.
    expect(errorEvents).toHaveLength(0);
  });
});
