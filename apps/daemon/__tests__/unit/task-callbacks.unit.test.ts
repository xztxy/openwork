import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type {
  PermissionRequest,
  StorageAPI,
  TaskManagerAPI,
  TaskSource,
} from '@accomplish_ai/agent-core';
import { createTaskCallbacks } from '../../src/task-callbacks.js';

/**
 * REGRESSIONS for the permission-dispatch guards added to `task-callbacks.ts`
 * in Phase 2 of the SDK cutover port, plus the follow-up no-bridge guard
 * landed in commit 70de1844 (Max review #4 / plan decision #10).
 *
 * The `onPermissionRequest` callback must route in four distinct ways:
 *   1. `source === 'whatsapp'` AND bridge attached (listenerCount > 1)
 *      → emit 'permission' so `wireTaskBridge` can auto-deny.
 *   2. `source === 'whatsapp'` AND bridge NOT attached (listenerCount ≤ 1)
 *      → auto-deny immediately (prevents task hang when WhatsApp is
 *      configured by source but the runtime bridge is not attached).
 *   3. `!'whatsapp'` AND no UI client connected → auto-deny.
 *   4. `!'whatsapp'` AND UI connected → emit.
 */

function buildFixture(options: { source: TaskSource; hasConnectedClients: boolean }) {
  const emitter = new EventEmitter();
  // Mirror the daemon's real wiring: task-event-forwarding attaches ONE
  // listener on 'permission' to forward to RPC. That baseline listener is
  // what makes `listenerCount <= 1` the right "no bridge" threshold.
  const rpcForwardListener = vi.fn();
  emitter.on('permission', rpcForwardListener);

  const sendPermissionResponse = vi.fn(async () => {});

  const storage = {
    addTaskMessage: vi.fn(),
    updateTaskStatus: vi.fn(),
    updateTaskSummary: vi.fn(),
    updateTaskSessionId: vi.fn(),
    clearTodosForTask: vi.fn(),
    saveTodosForTask: vi.fn(),
    getTasks: vi.fn(() => []),
    getTask: vi.fn(() => null),
  } as unknown as StorageAPI;

  const taskManager = {
    getSessionId: vi.fn(() => null),
  } as unknown as TaskManagerAPI;

  const callbacks = createTaskCallbacks('tsk_abc', emitter, storage, taskManager, {
    rpc: { hasConnectedClients: () => options.hasConnectedClients },
    getTaskSource: () => options.source,
    sendPermissionResponse,
  });

  return { callbacks, emitter, rpcForwardListener, sendPermissionResponse };
}

const fakeRequest: PermissionRequest = {
  id: 'filereq_xyz',
  taskId: 'tsk_abc',
  type: 'file',
  fileOperation: 'create',
  filePath: '/tmp/any.txt',
  timestamp: new Date().toISOString(),
};

describe('createTaskCallbacks — onPermissionRequest dispatch', () => {
  it("source='ui', UI connected → emits 'permission' (does NOT auto-deny)", () => {
    const f = buildFixture({ source: 'ui', hasConnectedClients: true });
    // Attach a listener so listenerCount > 1 would also pass a whatsapp
    // check (shouldn't matter here; asserting the UI path is emit-only).
    const bridgeListener = vi.fn();
    f.emitter.on('permission', bridgeListener);

    f.callbacks.onPermissionRequest?.(fakeRequest);

    expect(f.rpcForwardListener).toHaveBeenCalledWith(fakeRequest);
    expect(bridgeListener).toHaveBeenCalledWith(fakeRequest);
    expect(f.sendPermissionResponse).not.toHaveBeenCalled();
  });

  it("source='ui', no UI connected → auto-denies (does NOT emit bridge-side)", () => {
    const f = buildFixture({ source: 'ui', hasConnectedClients: false });

    f.callbacks.onPermissionRequest?.(fakeRequest);

    expect(f.sendPermissionResponse).toHaveBeenCalledWith('tsk_abc', {
      taskId: 'tsk_abc',
      requestId: 'filereq_xyz',
      decision: 'deny',
    });
    // Baseline RPC forwarder is still attached but since the handler chose
    // the auto-deny branch, it should NOT have been invoked with this
    // request.
    expect(f.rpcForwardListener).not.toHaveBeenCalled();
  });

  it("source='whatsapp', bridge attached (listenerCount > 1) → emits 'permission'", () => {
    const f = buildFixture({ source: 'whatsapp', hasConnectedClients: false });
    const bridgeListener = vi.fn();
    f.emitter.on('permission', bridgeListener);

    f.callbacks.onPermissionRequest?.(fakeRequest);

    expect(bridgeListener).toHaveBeenCalledWith(fakeRequest);
    // Auto-deny path must NOT run — the bridge will deny via
    // taskService.sendResponse from wireTaskBridge.
    expect(f.sendPermissionResponse).not.toHaveBeenCalled();
  });

  it("source='whatsapp', bridge NOT attached → auto-denies here (plan decision #10)", () => {
    // Only the baseline RPC forwarder is attached. listenerCount === 1.
    const f = buildFixture({ source: 'whatsapp', hasConnectedClients: false });

    f.callbacks.onPermissionRequest?.(fakeRequest);

    expect(f.sendPermissionResponse).toHaveBeenCalledWith('tsk_abc', {
      taskId: 'tsk_abc',
      requestId: 'filereq_xyz',
      decision: 'deny',
    });
  });

  it("source='scheduler', no UI connected → auto-denies", () => {
    const f = buildFixture({ source: 'scheduler', hasConnectedClients: false });

    f.callbacks.onPermissionRequest?.(fakeRequest);

    expect(f.sendPermissionResponse).toHaveBeenCalledWith('tsk_abc', {
      taskId: 'tsk_abc',
      requestId: 'filereq_xyz',
      decision: 'deny',
    });
  });

  it("source='scheduler', UI connected → emits 'permission' (user can still approve)", () => {
    const f = buildFixture({ source: 'scheduler', hasConnectedClients: true });

    f.callbacks.onPermissionRequest?.(fakeRequest);

    expect(f.rpcForwardListener).toHaveBeenCalledWith(fakeRequest);
    expect(f.sendPermissionResponse).not.toHaveBeenCalled();
  });

  it('auto-deny within a few milliseconds (<=100ms budget for scheduled tasks)', async () => {
    // Plan: "Phase 5 regression test — scheduled task with no UI auto-denies
    // within 100 ms". Measuring wall-clock on the callback itself is a
    // proxy for that requirement — the real 100ms budget is the end-to-end
    // path (startTask → onPermissionRequest → sendResponse) but the
    // callback's dispatch is the only piece we can unit-test without a
    // full daemon stack.
    const f = buildFixture({ source: 'scheduler', hasConnectedClients: false });

    const started = Date.now();
    f.callbacks.onPermissionRequest?.(fakeRequest);
    const elapsed = Date.now() - started;

    expect(f.sendPermissionResponse).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(50);
  });
});
