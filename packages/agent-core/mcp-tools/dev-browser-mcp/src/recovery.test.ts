import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTransportError, attemptRecovery, _resetRecoveryState } from './recovery.js';
import * as connection from './connection.js';

describe('isTransportError', () => {
  it('detects "fetch failed"', () => {
    expect(isTransportError(new Error('fetch failed'))).toBe(true);
  });

  it('detects "ECONNREFUSED"', () => {
    expect(isTransportError(new Error('connect ECONNREFUSED 127.0.0.1:9224'))).toBe(true);
  });

  it('detects "ECONNRESET"', () => {
    expect(isTransportError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('detects "socket hang up"', () => {
    expect(isTransportError(new Error('socket hang up'))).toBe(true);
  });

  it('detects "UND_ERR"', () => {
    expect(isTransportError(new Error('UND_ERR_SOCKET'))).toBe(true);
  });

  it('rejects non-transport errors', () => {
    expect(isTransportError(new Error('Element not found'))).toBe(false);
    expect(isTransportError(new Error('Timeout exceeded'))).toBe(false);
    expect(isTransportError(new Error('strict mode violation'))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isTransportError('fetch failed as a string')).toBe(true);
    expect(isTransportError(42)).toBe(false);
    expect(isTransportError(null)).toBe(false);
  });
});

describe('attemptRecovery', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let resetSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetRecoveryState();
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    resetSpy = vi.spyOn(connection, 'resetConnection');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns true when server comes back on first poll', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await attemptRecovery('http://localhost:9224');
    expect(result).toBe(true);
    expect(resetSpy).toHaveBeenCalledOnce();
  });

  it('returns true when server comes back on later poll', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));
    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = attemptRecovery('http://localhost:9224');

    // Advance through poll intervals
    await vi.advanceTimersByTimeAsync(1250);
    await vi.advanceTimersByTimeAsync(1250);

    const result = await promise;
    expect(result).toBe(true);
  });

  it('returns false when server stays down', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const promise = attemptRecovery('http://localhost:9224');

    // Advance through all poll intervals
    await vi.advanceTimersByTimeAsync(1250);
    await vi.advanceTimersByTimeAsync(1250);
    await vi.advanceTimersByTimeAsync(1250);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('returns false during cooldown period', async () => {
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

    const first = await attemptRecovery('http://localhost:9224');
    expect(first).toBe(true);

    // Second call within 10s cooldown
    const second = await attemptRecovery('http://localhost:9224');
    expect(second).toBe(false);
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('allows recovery after cooldown expires', async () => {
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

    const first = await attemptRecovery('http://localhost:9224');
    expect(first).toBe(true);

    // Advance past cooldown
    await vi.advanceTimersByTimeAsync(10_000);

    const second = await attemptRecovery('http://localhost:9224');
    expect(second).toBe(true);
    expect(resetSpy).toHaveBeenCalledTimes(2);
  });

  it('calls resetConnection during recovery', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await attemptRecovery('http://localhost:9224');
    expect(resetSpy).toHaveBeenCalledOnce();
  });
});
