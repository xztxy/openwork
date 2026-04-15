import type { IpcMainInvokeEvent } from 'electron';
import { shell } from 'electron';
import { validateHttpUrl } from '@accomplish_ai/agent-core';
import { getSlackMcpOauthStatus } from '@accomplish_ai/agent-core';
import { loginSlackMcp, logoutSlackMcp } from '../../../opencode/slack-auth';
import {
  loginGithubCopilot,
  logoutGithubCopilot,
  getCopilotOAuthStatus,
} from '../../../opencode/copilot-auth';
import type { IpcHandler } from '../../types';
import { getStorage } from '../../../store/storage';
import { ensureDaemonRunning } from '../../../daemon/daemon-connector';

export function registerAuthHandlers(handle: IpcHandler): void {
  const storage = getStorage();

  handle('settings:openai-base-url:get', async (_event: IpcMainInvokeEvent) => {
    return storage.getOpenAiBaseUrl();
  });

  handle('settings:openai-base-url:set', async (_event: IpcMainInvokeEvent, baseUrl: string) => {
    if (typeof baseUrl !== 'string') {
      throw new Error('Invalid base URL');
    }

    const trimmed = baseUrl.trim();
    if (!trimmed) {
      storage.setOpenAiBaseUrl('');
      return;
    }

    validateHttpUrl(trimmed, 'OpenAI base URL');
    storage.setOpenAiBaseUrl(trimmed.replace(/\/+$/, ''));
  });

  // Phase 4a of the SDK cutover port: OpenAI OAuth moved into the daemon
  // via a 4-method RPC protocol. Desktop's role is reduced to:
  //   - opening the authorize URL in the user's browser
  //     (Electron-only `shell.openExternal`)
  //   - proxying status / login RPCs from the renderer
  //
  // Renderer-facing IPC contracts kept unchanged:
  //   opencode:auth:openai:status → { connected, expires? }
  //   opencode:auth:openai:login  → { ok, openedUrl? }
  //
  // `plan` returned by `auth.openai.awaitCompletion` is consumed internally
  // by the Settings UI's model-dropdown logic via a subsequent status / model
  // fetch; it is intentionally NOT surfaced here to preserve the existing
  // renderer contract (plan lives on the agent-core type surface but is
  // only exposed where its consumers are).
  handle('opencode:auth:openai:status', async (_event: IpcMainInvokeEvent) => {
    const client = await ensureDaemonRunning();
    return (await client.call('auth.openai.status')) as { connected: boolean; expires?: number };
  });

  handle('opencode:auth:openai:login', async (_event: IpcMainInvokeEvent) => {
    const client = await ensureDaemonRunning();
    const { sessionId, authorizeUrl } = (await client.call('auth.openai.startLogin')) as {
      sessionId: string;
      authorizeUrl: string;
    };
    // Electron-only step: open the authorize URL in the user's default browser.
    // Keeping this on the desktop side is deliberate per plan decision #6 —
    // the daemon does not have access to Electron's `shell` API.
    await shell.openExternal(authorizeUrl);
    const completion = (await client.call('auth.openai.awaitCompletion', {
      sessionId,
      timeoutMs: 2 * 60_000,
    })) as { ok: boolean; plan?: unknown; error?: string };
    if (!completion.ok) {
      throw new Error(completion.error ?? 'OpenAI authentication failed.');
    }
    // Preserve the existing { ok, openedUrl? } contract expected by
    // apps/desktop/src/preload/index.ts and apps/web/src/client/lib/accomplish.ts.
    return { ok: true, openedUrl: authorizeUrl };
  });

  handle('opencode:auth:slack:status', async (_event: IpcMainInvokeEvent) => {
    return getSlackMcpOauthStatus();
  });

  handle('opencode:auth:slack:login', async (_event: IpcMainInvokeEvent) => {
    await loginSlackMcp();
    return { ok: true };
  });

  handle('opencode:auth:slack:logout', async (_event: IpcMainInvokeEvent) => {
    await logoutSlackMcp();
  });

  handle('opencode:auth:copilot:status', async (_event: IpcMainInvokeEvent) => {
    return getCopilotOAuthStatus();
  });

  handle('opencode:auth:copilot:login', async (_event: IpcMainInvokeEvent) => {
    try {
      const result = await loginGithubCopilot();
      return result;
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(String(err));
    }
  });

  handle('opencode:auth:copilot:logout', async (_event: IpcMainInvokeEvent) => {
    logoutGithubCopilot();
  });
}
