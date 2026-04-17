import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter } from '../../../../src/internal/classes/OpenCodeAdapter.js';
import { ACCOMPLISH_AGENT_NAME } from '../../../../src/opencode/config-generator.js';

/**
 * REGRESSION: the adapter used to pass `{ title }` to `session.create`
 * and nothing agent-related to `session.prompt`. The generated
 * `opencode.json` defines a custom `accomplish` agent containing the
 * entire Accomplish system prompt (skills, connectors, workspace
 * instructions, knowledge notes, etc.) and sets `default_agent:
 * 'accomplish'` at the config root. That default_agent IS honored by
 * the CLI path, which was invoked as `opencode --agent accomplish` —
 * but the SDK path (OpenCode SDK cutover port) has no implicit agent
 * selection. Without explicit `agent: ACCOMPLISH_AGENT_NAME` on each
 * `session.prompt`, OpenCode runs the session under its built-in
 * default agent and silently ignores the accomplish prompt.
 *
 * User-visible symptom: workspace `instruction`-type knowledge notes
 * are correctly written into the generated opencode.json (verified by
 * inspecting the file) but the model's replies show none of those
 * instructions being followed. The entire ~18KB Accomplish system
 * prompt — including the mandatory `<workspace-instructions>` block
 * prepended to the top — never reaches the model because the session
 * isn't configured to use the accomplish agent.
 *
 * Fix: pass `agent: ACCOMPLISH_AGENT_NAME` on BOTH session.prompt call
 * sites (initial prompt + continuation nudge). Per the SDK type defs
 * (`@opencode-ai/sdk@1.2.24`), `SessionPromptData.body` accepts
 * `agent?: string`; `SessionCreateData.body` does not have an agent
 * field so create stays agent-less.
 *
 * These tests pin the fix at the narrow seam:
 *   - Initial startTask → session.prompt carries `agent: 'accomplish'`.
 *   - Continuation prompt → also carries `agent: 'accomplish'`.
 * If a future SDK upgrade or refactor silently drops the field, these
 * tests fail loudly before the PR lands.
 */
describe('OpenCodeAdapter agent selection on session.prompt', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface PromptCall {
    sessionID: string;
    agent?: string;
    text?: string;
  }

  function buildFakeClient(): {
    client: unknown;
    promptCalls: PromptCall[];
  } {
    const promptCalls: PromptCall[] = [];

    const client = {
      session: {
        create: async (_args: { title: string }) => {
          return { id: 'session_abc' };
        },
        prompt: (args: { sessionID: string; agent?: string; parts: Array<{ text?: string }> }) => {
          promptCalls.push({
            sessionID: args.sessionID,
            agent: args.agent,
            text: args.parts[0]?.text,
          });
          return Promise.resolve();
        },
      },
      event: {
        subscribe: async () => {
          const stream: AsyncIterable<unknown> = {
            [Symbol.asyncIterator]() {
              return {
                next: () => new Promise(() => {}), // never resolves
              };
            },
          };
          return { stream, close: () => {} };
        },
      },
    };

    return { client, promptCalls };
  }

  async function runStartTask(
    adapter: OpenCodeAdapter,
    config: { prompt: string; sessionId?: string },
    fake: ReturnType<typeof buildFakeClient>,
  ): Promise<void> {
    (
      adapter as unknown as {
        options: { getServerUrl: (taskId: string) => Promise<string> };
      }
    ).options.getServerUrl = async () => 'http://127.0.0.1:4096';

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

    const startPromise = adapter.startTask({ ...config, taskId: 'tsk_agent_test' });
    await Promise.race([
      startPromise.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ]);
  }

  it('initial session.prompt carries agent: ACCOMPLISH_AGENT_NAME', async () => {
    const adapter = new OpenCodeAdapter(
      { platform: 'darwin', isPackaged: false, tempPath: '/tmp' },
      'tsk_agent_fresh',
    );
    const fake = buildFakeClient();
    await runStartTask(adapter, { prompt: 'tell me about yourself' }, fake);

    expect(fake.promptCalls.length).toBe(1);
    const call = fake.promptCalls[0];
    expect(call.agent).toBe(ACCOMPLISH_AGENT_NAME);
    expect(call.agent).toBe('accomplish'); // double-check the constant value
    expect(call.text).toBe('tell me about yourself');
  });

  it('resume (config.sessionId) session.prompt also carries agent: ACCOMPLISH_AGENT_NAME', async () => {
    const adapter = new OpenCodeAdapter(
      { platform: 'darwin', isPackaged: false, tempPath: '/tmp' },
      'tsk_agent_resume',
    );
    const fake = buildFakeClient();
    await runStartTask(
      adapter,
      { prompt: 'follow-up question', sessionId: 'existing_session' },
      fake,
    );

    expect(fake.promptCalls.length).toBe(1);
    expect(fake.promptCalls[0].agent).toBe(ACCOMPLISH_AGENT_NAME);
    expect(fake.promptCalls[0].sessionID).toBe('existing_session');
  });
});
