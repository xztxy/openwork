import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import {
  getWindowsOpenCodeServerPool,
  disposeWindowsOpenCodeServerPool,
} from '../../../src/internal/classes/OpenCodeServerPool.js';

class MockChildProcess extends EventEmitter {
  kill = vi.fn();
  unref = vi.fn();
}

describe('OpenCodeServerPool', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    fetchMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    disposeWindowsOpenCodeServerPool();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not hand out warming servers as warm leases before they are ready', async () => {
    const readyPorts = new Set<number>();
    let spawnCount = 0;

    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new MockChildProcess();
      const portFlagIndex = args.indexOf('--port');
      const port = Number(args[portFlagIndex + 1]);
      spawnCount += 1;

      // Keep first warm-up server unready so acquire must cold-spawn a separate server.
      if (spawnCount >= 2) {
        readyPorts.add(port);
      }

      return child;
    });

    fetchMock.mockImplementation(async (url: string) => {
      const port = Number(new URL(url).port);
      if (readyPorts.has(port)) {
        return { status: 200 };
      }
      throw new Error('not ready');
    });

    const pool = getWindowsOpenCodeServerPool(
      {
        getCliCommand: () => ({ command: 'opencode.exe', args: [] }),
        cwd: process.cwd(),
        buildEnvironment: async () => ({}),
      },
      {
        minIdle: 1,
        maxTotal: 2,
        coldStartFallback: false,
        startupTimeoutMs: 2000,
      },
    );

    const lease = await pool.acquire();
    expect(lease).not.toBeNull();
    expect(lease?.source).toBe('cold');

    lease?.retire();
  });

  it('returns null (direct CLI fallback) when warm/cold server startup fails', async () => {
    spawnMock.mockImplementation(() => {
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.emit('error', new Error('spawn failed'));
      });
      return child;
    });

    fetchMock.mockRejectedValue(new Error('unreachable'));

    const pool = getWindowsOpenCodeServerPool(
      {
        getCliCommand: () => ({ command: 'opencode.exe', args: [] }),
        cwd: process.cwd(),
        buildEnvironment: async () => ({}),
      },
      {
        minIdle: 1,
        maxTotal: 2,
        coldStartFallback: true,
        startupTimeoutMs: 1000,
      },
    );

    await expect(pool.acquire()).resolves.toBeNull();
  });
});
