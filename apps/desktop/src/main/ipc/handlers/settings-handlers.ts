import { BrowserWindow, nativeTheme } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { validateHttpUrl, sanitizeString } from '@accomplish_ai/agent-core';
import { getOpenAiOauthStatus, getSlackMcpOauthStatus } from '@accomplish_ai/agent-core';
import { loginOpenAiWithChatGpt } from '../../opencode/auth-browser';
import { loginSlackMcp, logoutSlackMcp } from '../../opencode/slack-auth';
import { isOpenCodeCliInstalled, getOpenCodeCliVersion } from '../../opencode';
import { getStorage } from '../../store/storage';
import { handle, isE2ESkipAuthEnabled } from './utils';

export function registerSettingsHandlers(): void {
  const storage = getStorage();

  handle('settings:debug-mode', async (_event: IpcMainInvokeEvent) => {
    return storage.getDebugMode();
  });

  handle('settings:set-debug-mode', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid debug mode flag');
    }
    storage.setDebugMode(enabled);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:debug-mode-changed', { enabled });
    }
  });

  handle('settings:theme', async (_event: IpcMainInvokeEvent) => {
    return storage.getTheme();
  });

  handle('settings:set-theme', async (_event: IpcMainInvokeEvent, theme: string) => {
    if (!['system', 'light', 'dark'].includes(theme)) {
      throw new Error('Invalid theme value');
    }
    storage.setTheme(theme as 'system' | 'light' | 'dark');
    nativeTheme.themeSource = theme as 'system' | 'light' | 'dark';

    const resolved =
      theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme;

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:theme-changed', { theme, resolved });
    }
  });

  handle('settings:app-settings', async (_event: IpcMainInvokeEvent) => {
    return storage.getAppSettings();
  });

  handle('settings:cloud-browser-config:get', async (_event: IpcMainInvokeEvent) => {
    return storage.getCloudBrowserConfig();
  });

  handle(
    'settings:cloud-browser-config:set',
    async (_event: IpcMainInvokeEvent, config: string | null) => {
      if (config === null) {
        storage.setCloudBrowserConfig(null);
        return;
      }
      if (typeof config !== 'string') {
        throw new Error('Invalid cloud browser config');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(config);
      } catch {
        throw new Error('Invalid cloud browser config: malformed JSON');
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid cloud browser config: expected object');
      }
      const cfg = parsed as Record<string, unknown>;
      if (cfg.activeProvider !== null && typeof cfg.activeProvider !== 'string') {
        throw new Error('Invalid cloud browser config: activeProvider must be string or null');
      }
      storage.setCloudBrowserConfig(cfg as Parameters<typeof storage.setCloudBrowserConfig>[0]);
    },
  );

  handle('sandbox:get-config', async (_event: IpcMainInvokeEvent) => {
    return storage.getSandboxConfig();
  });

  handle(
    'sandbox:set-config',
    async (
      _event: IpcMainInvokeEvent,
      config: {
        mode: string;
        allowedPaths: string[];
        networkRestricted: boolean;
        allowedHosts: string[];
        dockerImage?: string;
        networkPolicy?: { allowOutbound: boolean; allowedHosts?: string[] };
      },
    ) => {
      if (!config || typeof config !== 'object') {
        throw new Error('Invalid sandbox configuration');
      }
      if (!['disabled', 'native', 'docker'].includes(config.mode)) {
        throw new Error('Invalid sandbox mode. Must be "disabled", "native", or "docker".');
      }
      if (!Array.isArray(config.allowedPaths)) {
        throw new Error('allowedPaths must be an array');
      }
      if (typeof config.networkRestricted !== 'boolean') {
        throw new Error('networkRestricted must be a boolean');
      }
      if (!Array.isArray(config.allowedHosts)) {
        throw new Error('allowedHosts must be an array');
      }

      storage.setSandboxConfig({
        mode: config.mode as 'disabled' | 'native' | 'docker',
        allowedPaths: config.allowedPaths.map((p) => sanitizeString(p, 'allowedPath', 512)),
        networkRestricted: config.networkRestricted,
        allowedHosts: config.allowedHosts.map((h) => sanitizeString(h, 'allowedHost', 256)),
        ...(config.dockerImage !== undefined && {
          dockerImage: sanitizeString(config.dockerImage, 'dockerImage', 256),
        }),
        ...(config.networkPolicy !== undefined && {
          networkPolicy: {
            allowOutbound: Boolean(config.networkPolicy.allowOutbound),
            ...(Array.isArray(config.networkPolicy.allowedHosts) && {
              allowedHosts: config.networkPolicy.allowedHosts.map((h) =>
                sanitizeString(h, 'networkPolicy.allowedHost', 256),
              ),
            }),
          },
        }),
      });
    },
  );

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
    const result = await loginOpenAiWithChatGpt();
    return { ok: true, ...result };
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

  handle('onboarding:complete', async (_event: IpcMainInvokeEvent) => {
    if (isE2ESkipAuthEnabled()) {
      return true;
    }

    if (storage.getOnboardingComplete()) {
      return true;
    }

    const tasks = storage.getTasks();
    if (tasks.length > 0) {
      storage.setOnboardingComplete(true);
      return true;
    }

    return false;
  });

  handle('onboarding:set-complete', async (_event: IpcMainInvokeEvent, complete: boolean) => {
    storage.setOnboardingComplete(complete);
  });

  handle('opencode:check', async (_event: IpcMainInvokeEvent) => {
    if (isE2ESkipAuthEnabled()) {
      return {
        installed: true,
        version: '1.0.0-test',
        installCommand: 'npm install -g opencode-ai',
      };
    }

    const installed = await isOpenCodeCliInstalled();
    const version = installed ? await getOpenCodeCliVersion() : null;
    return {
      installed,
      version,
      installCommand: 'npm install -g opencode-ai',
    };
  });

  handle('opencode:version', async (_event: IpcMainInvokeEvent) => {
    return getOpenCodeCliVersion();
  });
}
