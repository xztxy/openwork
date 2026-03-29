/**
 * app-startup.ts — async startup body for `app.whenReady()`.
 *
 * Extracted from main/index.ts to keep index.ts focused on
 * top-level bootstrap (single-instance lock, env, window factory).
 */

import { app, BrowserWindow, dialog, nativeImage, nativeTheme } from 'electron';
import path from 'path';
import { FutureSchemaError } from '@accomplish_ai/agent-core';
import type { ProviderId } from '@accomplish_ai/agent-core';
import { initThoughtStreamApi, startThoughtStreamServer } from './thought-stream-api';
import { getTaskManager } from './opencode';
import { migrateLegacyData } from './store/legacyMigration';
import { initializeStorage, getStorage } from './store/storage';
import { getApiKey } from './store/secureStorage';
import * as workspaceManager from './store/workspaceManager';
import { getLogCollector } from './logging';
import { skillsManager } from './skills';
import { startHuggingFaceServer } from './providers/huggingface-local';
import { createTray } from './tray';
import { bootstrapDaemon } from './daemon-bootstrap';
import { registerIPCHandlers } from './ipc/handlers';

function logMain(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) {
  try {
    const l = getLogCollector();
    if (l?.log) l.log(level, 'main', msg, data);
  } catch (_e) {
    /* best-effort */
  }
}

export type CreateWindowFn = () => void;

/**
 * Async startup body — called inside `app.whenReady().then(...)`.
 */
export async function startApp(
  createWindow: CreateWindowFn,
  getMainWindow: () => BrowserWindow | null,
  isQuittingRef: { value: boolean },
): Promise<void> {
  logMain('INFO', `[Main] Electron app ready, version: ${app.getVersion()}`);

  if (process.env.CLEAN_START !== '1') {
    try {
      const didMigrate = migrateLegacyData();
      if (didMigrate) logMain('INFO', '[Main] Migrated data from legacy userData path');
    } catch (err) {
      logMain('ERROR', '[Main] Legacy data migration failed', { err: String(err) });
    }
  }

  try {
    initializeStorage();
  } catch (err) {
    if (err instanceof FutureSchemaError) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Required',
        message: `This data was created by a newer version of Accomplish (schema v${err.storedVersion}).`,
        detail: `Your app supports up to schema v${err.appVersion}. Please update Accomplish to continue.`,
        buttons: ['Quit'],
      });
      app.quit();
      return;
    }
    throw err;
  }

  try {
    workspaceManager.initialize();
  } catch (err) {
    logMain('ERROR', '[Main] Workspace initialization failed', { err: String(err) });
    throw err;
  }

  try {
    const storage = getStorage();
    const settings = storage.getProviderSettings();
    for (const [id, provider] of Object.entries(settings.connectedProviders)) {
      const providerId = id as ProviderId;
      const credType = provider?.credentials?.type;
      if (!credType || credType === 'api_key') {
        const key = getApiKey(providerId);
        if (!key) {
          logMain(
            'WARN',
            `[Main] Provider ${providerId} has api_key auth but key not found in secure storage`,
          );
          storage.removeConnectedProvider(providerId);
          logMain('INFO', `[Main] Removed provider ${providerId} due to missing API key`);
        }
      }
    }
    const hfConfig = storage.getHuggingFaceLocalConfig();
    if (hfConfig?.enabled && hfConfig.selectedModelId) {
      logMain(
        'INFO',
        `[Main] Auto-starting HuggingFace server for model: ${hfConfig.selectedModelId}`,
      );
      startHuggingFaceServer(hfConfig.selectedModelId)
        .then((result) => {
          if (!result.success) {
            logMain('ERROR', '[Main] Failed to auto-start HuggingFace local server', {
              error: result.error,
            });
          }
        })
        .catch((err: unknown) => {
          logMain('ERROR', '[Main] Failed to auto-start HuggingFace local server (thrown)', {
            err: String(err),
          });
        });
    }
  } catch (err) {
    logMain('ERROR', '[Main] Provider validation failed', { err: String(err) });
  }

  await skillsManager.initialize();

  if (process.platform === 'darwin' && app.dock) {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(process.env.APP_ROOT!, 'resources', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  try {
    nativeTheme.themeSource = getStorage().getTheme();
  } catch {
    // First launch or corrupt DB — nativeTheme stays 'system'
  }

  const taskManager = getTaskManager();
  const storage = getStorage();
  await bootstrapDaemon({ taskManager, storage });
  logMain('INFO', '[Main] Daemon bootstrapped');

  registerIPCHandlers();
  logMain('INFO', '[Main] IPC handlers registered');

  createWindow();

  const mainWindow = getMainWindow();
  if (mainWindow) {
    initThoughtStreamApi(mainWindow);
    startThoughtStreamServer();

    mainWindow.on('close', (event) => {
      if (!isQuittingRef.value) {
        event.preventDefault();
        mainWindow?.hide();
        logMain('INFO', '[Main] Window hidden to tray');
      }
    });

    createTray(mainWindow);
    logMain('INFO', '[Main] System tray created');
  }

  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      createWindow();
      try {
        getLogCollector()?.logEnv?.('INFO', '[Main] Application reactivated; recreated window');
      } catch (_e) {
        /* ignore */
      }
    } else {
      windows[0].show();
      windows[0].focus();
      try {
        getLogCollector()?.logEnv?.(
          'INFO',
          '[Main] Application reactivated; showed existing window',
        );
      } catch (_e) {
        /* ignore */
      }
    }
  });
}
