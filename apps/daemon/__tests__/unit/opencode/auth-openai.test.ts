import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Phase 5 test for the OpenAI OAuth RPC round-trip (added by Phase 4a of the
 * SDK cutover port). Covers:
 *   - startLogin returns a sessionId + authorizeUrl from the SDK
 *   - awaitCompletion resolves with { ok: true, plan } once the auth-state
 *     file reports connected
 *   - awaitCompletion returns { ok: false, error: 'awaitCompletion RPC
 *     timed out.' } when the caller-supplied timeoutMs is short enough that
 *     the internal polling hasn't produced a result yet
 *
 * The transient `opencode serve` and auth-state polling helpers are mocked
 * so the test runs without a real runtime or filesystem side-effects.
 */

let connected = false;
let oauthPlanValue: 'free' | 'paid' = 'paid';

vi.mock('@accomplish_ai/agent-core', () => ({
  detectOpenAiOauthPlan: vi.fn(async () => oauthPlanValue),
  getOpenAiOauthAccessToken: vi.fn(() => (connected ? 'sk-fake-token' : null)),
  getOpenAiOauthStatus: vi.fn(() =>
    connected ? { connected: true, expires: Date.now() + 3600_000 } : { connected: false },
  ),
  getOpenCodeAuthJsonPath: vi.fn(() => '/tmp/fake-auth.json'),
}));

vi.mock('../../../src/logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const transientCloseMock = vi.fn();
const providerAuthMock = vi.fn(async () => ({
  data: {
    openai: [
      { type: 'oauth' as const, label: 'ChatGPT Pro/Plus' },
      { type: 'api' as const, label: 'API Key' },
    ],
  },
}));
const oauthAuthorizeMock = vi.fn(async () => ({
  data: { url: 'https://auth.openai.com/login?client_id=fake' },
}));

vi.mock('../../../src/opencode/server-manager.js', () => ({
  createTransientOpencodeClient: vi.fn(async () => ({
    client: {
      provider: {
        auth: providerAuthMock,
        oauth: { authorize: oauthAuthorizeMock },
      },
    },
    close: transientCloseMock,
  })),
}));

// Import the manager AFTER the mocks so it picks them up.
const { OpenAiOauthManager } = await import('../../../src/opencode/auth-openai.js');

describe('OpenAiOauthManager', () => {
  beforeEach(() => {
    connected = false;
    oauthPlanValue = 'paid';
    transientCloseMock.mockClear();
    providerAuthMock.mockClear();
    oauthAuthorizeMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startLogin returns a sessionId + authorizeUrl from the SDK', async () => {
    const manager = new OpenAiOauthManager({} as never);

    const { sessionId, authorizeUrl } = await manager.startLogin();

    expect(sessionId).toMatch(/^[0-9a-f-]{30,}$/i);
    expect(authorizeUrl).toBe('https://auth.openai.com/login?client_id=fake');
    expect(providerAuthMock).toHaveBeenCalledOnce();
    expect(oauthAuthorizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerID: 'openai', method: 0 }),
    );

    manager.dispose();
    expect(transientCloseMock).toHaveBeenCalled();
  });

  it('awaitCompletion resolves with { ok: true, plan } once auth state reports connected', async () => {
    const manager = new OpenAiOauthManager({} as never);
    oauthPlanValue = 'paid';

    const { sessionId } = await manager.startLogin();

    // Flip the mocked auth-state flag after a short delay — simulates the
    // user finishing the browser OAuth handshake.
    setTimeout(() => {
      connected = true;
    }, 50);

    const result = await manager.awaitCompletion({ sessionId, timeoutMs: 5_000 });

    expect(result).toEqual({ ok: true, plan: 'paid' });
    expect(transientCloseMock).toHaveBeenCalled();
  });

  it('awaitCompletion returns { ok: false } when the RPC timeoutMs fires before the flow completes', async () => {
    const manager = new OpenAiOauthManager({} as never);

    const { sessionId } = await manager.startLogin();
    // Never flip `connected` — the internal 2-minute poll loop keeps
    // waiting, but the caller-supplied RPC timeout aborts sooner.
    const result = await manager.awaitCompletion({ sessionId, timeoutMs: 50 });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/timed out/i);
    }

    manager.dispose();
  });

  it('startLogin aborts the prior active session when called twice', async () => {
    const manager = new OpenAiOauthManager({} as never);

    const first = await manager.startLogin();
    // Second startLogin should abort the first session's runtime.
    const second = await manager.startLogin();

    expect(second.sessionId).not.toBe(first.sessionId);
    // `close` fires for the first runtime on abort, plus each successful
    // runtime teardown — count at least 1 (the abort).
    expect(transientCloseMock).toHaveBeenCalled();

    manager.dispose();
  });

  it('awaitCompletion rejects unknown sessionIds without crashing', async () => {
    const manager = new OpenAiOauthManager({} as never);

    const result = await manager.awaitCompletion({
      sessionId: 'nonexistent',
      timeoutMs: 100,
    });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/No matching/i) });
    manager.dispose();
  });

  it('status() and getAccessToken() read through the agent-core helpers', async () => {
    const manager = new OpenAiOauthManager({} as never);

    expect(manager.status()).toEqual({ connected: false });
    expect(manager.getAccessToken()).toBeNull();

    connected = true;
    const status = manager.status();
    expect(status.connected).toBe(true);
    expect(manager.getAccessToken()).toBe('sk-fake-token');

    manager.dispose();
  });
});
