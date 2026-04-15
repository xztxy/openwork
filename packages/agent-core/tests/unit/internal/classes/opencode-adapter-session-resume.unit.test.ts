import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter } from '../../../../src/internal/classes/OpenCodeAdapter.js';

/**
 * REGRESSION: the adapter used to call `client.session.create(...)`
 * unconditionally on every `startTask`, ignoring `config.sessionId`.
 * That broke conversation continuity across follow-up turns — every
 * `resumeSession(sessionId, prompt)` → `_runTask` → `startTask` created
 * a brand-new SDK session with ZERO memory of prior turns, producing
 * the user-visible bug: "What is 7+4?" → "7+4=11" → "add 5 to the
 * result" → clarification popup because the agent didn't know what
 * "the result" referred to.
 *
 * The fix (commit 73fe6272) reuses `config.sessionId` when provided
 * and only calls `session.create` for genuinely new tasks. These
 * tests pin the branch.
 *
 * Full exercise of the SDK spawn path is out of scope here — we
 * validate the decision at a narrow seam by mocking the SDK client
 * factory and asserting whether `session.create` gets called.
 */
describe('OpenCodeAdapter session resume (sessionId reuse)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface SessionCreateMock {
    calls: number;
    lastTitle?: string;
  }
  interface SessionPromptMock {
    calls: number;
    lastSessionID?: string;
    lastText?: string;
  }

  /**
   * Build a fake SDK client exposing just the surface `startTask` uses.
   * Returns the client plus introspection handles for the mocks.
   */
  function buildFakeClient(): {
    client: unknown;
    sessionCreate: SessionCreateMock;
    sessionPrompt: SessionPromptMock;
  } {
    const sessionCreate: SessionCreateMock = { calls: 0 };
    const sessionPrompt: SessionPromptMock = { calls: 0 };

    const client = {
      session: {
        create: async (args: { title: string }) => {
          sessionCreate.calls += 1;
          sessionCreate.lastTitle = args.title;
          return { id: 'freshly_created_session_id' };
        },
        prompt: (args: { sessionID: string; parts: Array<{ text: string }> }) => {
          sessionPrompt.calls += 1;
          sessionPrompt.lastSessionID = args.sessionID;
          sessionPrompt.lastText = args.parts[0]?.text;
          return Promise.resolve();
        },
      },
      event: {
        subscribe: async () => {
          // Match the SDK shape the adapter consumes: `subscription.stream`
          // is an AsyncIterable<Event>, plus an optional close(). The
          // stream never yields — enough for startTask to open a
          // subscription and return; the test asserts on synchronous
          // side-effects (session.create / session.prompt call counts).
          const stream: AsyncIterable<unknown> = {
            [Symbol.asyncIterator]() {
              return {
                next: () => new Promise(() => {}), // never resolves
              };
            },
          };
          return {
            stream,
            close: () => {},
          };
        },
      },
    };

    return { client, sessionCreate, sessionPrompt };
  }

  async function runStartTask(
    adapter: OpenCodeAdapter,
    config: { prompt: string; sessionId?: string; modelId?: string },
    fake: ReturnType<typeof buildFakeClient>,
  ): Promise<void> {
    // Inject the fake SDK client via the "createOpencodeClient" private
    // path. The adapter's `startTask` constructs the client from
    // `options.getServerUrl`, so we stub the options and patch
    // `createOpencodeClient` indirectly by overwriting the property
    // right before the call resolves.
    (
      adapter as unknown as {
        options: { getServerUrl: (taskId: string) => Promise<string> };
      }
    ).options.getServerUrl = async () => 'http://127.0.0.1:4096';

    // Patch the adapter's client assignment. `startTask` assigns
    // `this.client = createOpencodeClient(...)`; we intercept by
    // installing a getter/setter on `client` that routes to our fake
    // the first time it's set.
    let clientAssigned = false;
    Object.defineProperty(adapter, 'client', {
      configurable: true,
      get() {
        return clientAssigned ? fake.client : null;
      },
      set(_value: unknown) {
        clientAssigned = true;
      },
    });

    // Kick off startTask in the background — it will block on the
    // never-resolving event iterator. Race against a short timer so
    // the test doesn't hang on a regression.
    const startPromise = adapter.startTask({ ...config, taskId: 'tsk_test' });
    await Promise.race([
      startPromise.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ]);
  }

  it('calls session.create when config.sessionId is not provided', async () => {
    const adapter = new OpenCodeAdapter(
      { platform: 'darwin', isPackaged: false, tempPath: '/tmp' },
      'tsk_fresh',
    );
    const fake = buildFakeClient();
    await runStartTask(adapter, { prompt: 'What is 7+4?' }, fake);

    expect(fake.sessionCreate.calls).toBe(1);
    expect(fake.sessionPrompt.calls).toBe(1);
    expect(fake.sessionPrompt.lastSessionID).toBe('freshly_created_session_id');
    expect(fake.sessionPrompt.lastText).toBe('What is 7+4?');
  });

  it('reuses config.sessionId and does NOT call session.create on resume', async () => {
    const adapter = new OpenCodeAdapter(
      { platform: 'darwin', isPackaged: false, tempPath: '/tmp' },
      'tsk_resume',
    );
    const fake = buildFakeClient();
    await runStartTask(
      adapter,
      { prompt: 'add 5 to the result', sessionId: 'session_from_turn_1' },
      fake,
    );

    // The real bug: session.create used to be called every time,
    // creating a fresh session per turn and destroying memory.
    expect(fake.sessionCreate.calls).toBe(0);
    expect(fake.sessionPrompt.calls).toBe(1);
    expect(fake.sessionPrompt.lastSessionID).toBe('session_from_turn_1');
    expect(fake.sessionPrompt.lastText).toBe('add 5 to the result');
  });
});
