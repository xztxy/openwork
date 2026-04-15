/**
 * Daemon-side OpenAI ChatGPT OAuth orchestration.
 *
 * Ports the SDK-based OAuth flow from commercial
 * `1a320029:apps/desktop/src/main/opencode/auth-browser.ts`. In commercial
 * the flow ran inside Electron main; in OSS it lives in the daemon because
 * the daemon owns `opencode serve` lifecycle (Phase 2 of the SDK cutover
 * port). Desktop keeps the Electron-only `shell.openExternal` step and
 * drives the two daemon RPCs.
 *
 * Phase 4a RPC protocol (registered in `daemon-routes.ts`):
 *   - `auth.openai.startLogin()` → `{ sessionId, authorizeUrl }`
 *   - `auth.openai.awaitCompletion({ sessionId, timeoutMs? })` → plan
 *   - `auth.openai.status()` → `{ connected, expires? }`
 *   - `auth.openai.getAccessToken()` → `string | null`
 *
 * The manager holds at most one in-flight session at a time (matches
 * commercial's `OAuthBrowserFlow` class). A second `startLogin` aborts the
 * first — typical when a user retries without explicitly cancelling.
 */

import { randomUUID } from 'node:crypto';
import {
  detectOpenAiOauthPlan,
  getOpenAiOauthAccessToken,
  getOpenAiOauthStatus,
  getOpenCodeAuthJsonPath,
  type OpenAiOauthPlan,
} from '@accomplish_ai/agent-core';
import { log } from '../logger.js';
import { createTransientOpencodeClient, type ServerManagerDeps } from './server-manager.js';

const OPENAI_PROVIDER_ID = 'openai';
const OPENAI_AUTH_TIMEOUT_MS = 2 * 60_000;
const OPENAI_AUTH_POLL_MS = 1_000;
const PREFERRED_OAUTH_LABEL = 'ChatGPT Pro/Plus';

class OAuthLoginError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    this.name = 'OAuthLoginError';
  }
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Pick the OAuth-type auth method the SDK's `provider.auth` response lists
 * for OpenAI. Prefers the `ChatGPT Pro/Plus` label (matches commercial)
 * because that's the flow that produces an `openai.access` JWT from which
 * we decode the chatgpt_plan_type. Falls back to any oauth-type entry.
 */
function pickOauthMethodIndex(methods: Array<{ type: 'oauth' | 'api'; label: string }>): number {
  const preferred = methods.findIndex(
    (m) => m.type === 'oauth' && m.label === PREFERRED_OAUTH_LABEL,
  );
  if (preferred !== -1) return preferred;
  const anyOauth = methods.findIndex((m) => m.type === 'oauth');
  if (anyOauth !== -1) return anyOauth;
  throw new OAuthLoginError('OpenAI authentication is not available in this OpenCode runtime.');
}

/**
 * Poll the OpenCode auth-state file until the OpenAI entry reports
 * `connected`. Resolves on success, rejects on timeout or abort. The
 * configured deadline matches commercial (`OPENAI_AUTH_TIMEOUT_MS = 2m`).
 */
async function waitForOpenAiConnection(signal: AbortSignal, deadline: number): Promise<void> {
  while (true) {
    if (signal.aborted) throw abortError('OpenAI authentication was cancelled.');
    if (getOpenAiOauthStatus().connected) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new OAuthLoginError('OpenAI authentication timed out. Please try again.');
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        Math.min(OPENAI_AUTH_POLL_MS, remaining),
      );
      const onAbort = () => {
        clearTimeout(timeout);
        reject(abortError('OpenAI authentication was cancelled.'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

interface ActiveSession {
  sessionId: string;
  abortController: AbortController;
  authorizeUrl: string;
  /** Promise that resolves when the SDK-reported OAuth completes (or rejects on timeout/abort). */
  completion: Promise<OpenAiOauthPlan>;
  runtime: { close: () => void };
}

export class OpenAiOauthManager {
  private active: ActiveSession | null = null;
  private disposed = false;

  constructor(private readonly deps: ServerManagerDeps) {}

  /**
   * Start a new OAuth flow. Spawns a transient `opencode serve`, asks the
   * SDK for OpenAI auth methods, issues the oauth.authorize request, and
   * returns the authorize URL plus a session handle. Desktop's IPC handler
   * is expected to then call `shell.openExternal(authorizeUrl)` and
   * follow with `awaitCompletion(sessionId)`.
   *
   * If a prior session is still active it is aborted — users who click the
   * sign-in button twice should get the fresher flow.
   */
  async startLogin(): Promise<{ sessionId: string; authorizeUrl: string }> {
    if (this.disposed) {
      throw new OAuthLoginError('OAuth manager is disposed.');
    }

    if (this.active) {
      log.info('[auth.openai] Aborting prior in-flight session before starting a new one');
      this.abortActive();
    }

    const sessionId = randomUUID();
    const abortController = new AbortController();
    const signal = abortController.signal;

    // Stand up a transient opencode serve for the duration of this flow.
    // Commercial used "openai-provider-auth" as the marker taskId; we reuse
    // the sessionId so the daemon's server-manager doesn't risk task-id
    // collisions with real tasks.
    const runtime = await createTransientOpencodeClient(this.deps, signal);
    if (signal.aborted) {
      runtime.close();
      throw abortError('OpenAI authentication was cancelled.');
    }

    // Query available methods, pick an oauth entry.
    const authResult = await runtime.client.provider.auth();
    const methods = (
      authResult.data as Record<string, Array<{ type: 'oauth' | 'api'; label: string }>> | undefined
    )?.[OPENAI_PROVIDER_ID];
    if (!methods || methods.length === 0) {
      runtime.close();
      throw new OAuthLoginError('OpenAI authentication is not available in this OpenCode runtime.');
    }

    // SDK 1.2.24's provider.oauth.authorize signature:
    //   (parameters: { providerID, method?, directory?, workspace? }, options?)
    //   → { data?: { url?: string } }
    // Commercial 1a320029 was written against an earlier SDK that used
    // `{ path, body }`; the 1.2.24 shape folds those into flat parameters.
    const methodIndex = pickOauthMethodIndex(methods);
    const authorize = await runtime.client.provider.oauth.authorize({
      providerID: OPENAI_PROVIDER_ID,
      method: methodIndex,
    });

    const authorizeUrl = (authorize.data as { url?: string } | undefined)?.url;
    if (!authorizeUrl) {
      runtime.close();
      throw new OAuthLoginError('OpenAI authentication did not return an authorization URL.');
    }

    // Poll for completion in the background; the promise is surfaced via
    // `awaitCompletion(sessionId)`. We capture it at this point so a caller
    // that calls awaitCompletion immediately after startLogin doesn't race
    // the manager's state write.
    const deadline = Date.now() + OPENAI_AUTH_TIMEOUT_MS;
    const completion = (async () => {
      try {
        await waitForOpenAiConnection(signal, deadline);
        return await detectOpenAiOauthPlan({ authStatePath: getOpenCodeAuthJsonPath() });
      } finally {
        // Tear down the transient runtime once the flow resolves or aborts —
        // regardless of success. Guard against double-close.
        try {
          runtime.close();
        } catch {
          /* ignore */
        }
        if (this.active?.sessionId === sessionId) {
          this.active = null;
        }
      }
    })();

    this.active = {
      sessionId,
      abortController,
      authorizeUrl,
      completion,
      runtime,
    };

    return { sessionId, authorizeUrl };
  }

  /**
   * Block until the given session's flow completes, times out, or is aborted.
   * Returns `{ ok: true, plan }` on success, `{ ok: false, error }` on
   * failure. A `timeoutMs` shorter than the internal deadline may be
   * supplied; it caps how long the RPC call blocks rather than changing the
   * flow's own deadline (commercial's 2-minute window stays).
   */
  async awaitCompletion(params: {
    sessionId: string;
    timeoutMs?: number;
  }): Promise<{ ok: true; plan: OpenAiOauthPlan } | { ok: false; error: string }> {
    const session = this.active;
    if (!session || session.sessionId !== params.sessionId) {
      return { ok: false, error: 'No matching in-flight OAuth session.' };
    }

    const timeoutMs = params.timeoutMs ?? OPENAI_AUTH_TIMEOUT_MS;
    try {
      const plan = await Promise.race([
        session.completion,
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new OAuthLoginError('awaitCompletion RPC timed out.')),
            timeoutMs,
          );
        }),
      ]);
      return { ok: true, plan };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Non-flow status read — delegates to the agent-core helper. */
  status(): { connected: boolean; expires?: number } {
    return getOpenAiOauthStatus();
  }

  /** Return the current access token from the OAuth state file, or null. */
  getAccessToken(): string | null {
    return getOpenAiOauthAccessToken();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortActive();
  }

  private abortActive(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.abortController.abort();
    try {
      active.runtime.close();
    } catch {
      /* ignore */
    }
  }
}
