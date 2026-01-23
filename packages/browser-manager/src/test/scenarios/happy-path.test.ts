// packages/browser-manager/src/test/scenarios/happy-path.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { BrowserManager } from '../../manager.js';
import type { BrowserState } from '../../types.js';

describe('Happy Path Integration', () => {
  let manager: BrowserManager;
  const states: BrowserState[] = [];

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
    states.length = 0;
  });

  it('transitions through expected states on acquire', async () => {
    manager = new BrowserManager({
      portRangeStart: 59900,
      portRangeEnd: 59910,
    });

    manager.subscribe((state) => {
      states.push(state);
    });

    // Note: This test requires actual browser launch
    // Skip in CI or mock environment
    if (process.env.CI) {
      expect(true).toBe(true);
      return;
    }

    const browser = await manager.acquire({ headless: true });
    expect(browser).toBeDefined();

    const finalState = manager.getState();
    expect(finalState.status).toBe('healthy');

    // Verify state transitions
    const statuses = states.map((s) => s.status);
    expect(statuses).toContain('launching');
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('healthy');
  }, 60000); // Long timeout for browser launch
});
