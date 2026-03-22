import type { IpcMainInvokeEvent } from 'electron';
import { validateHttpUrl } from '@accomplish_ai/agent-core';
import { getOpenAiOauthStatus, getSlackMcpOauthStatus } from '@accomplish_ai/agent-core';
import { loginOpenAiWithChatGpt } from '../../../opencode/auth-browser';
import { loginSlackMcp, logoutSlackMcp } from '../../../opencode/slack-auth';
import type { IpcHandler } from '../../types';
import { getStorage } from '../../../store/storage';

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

  handle('opencode:auth:openai:status', async (_event: IpcMainInvokeEvent) => {
    return getOpenAiOauthStatus();
  });

  handle('opencode:auth:openai:login', async (_event: IpcMainInvokeEvent) => {
    try {
      const result = await loginOpenAiWithChatGpt();
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('package manager failed') ||
        message.includes('failed to install') ||
        message.includes('opencode-darwin') ||
        message.includes('opencode-linux') ||
        message.includes('opencode-win32') ||
        message.includes('manually installing')
      ) {
        throw new Error(
          'OpenCode CLI installation issue detected. Please try restarting the app or reinstalling from accomplish.ai',
        );
      }
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(String(err));
    }
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
}
