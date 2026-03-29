import { config } from 'dotenv';
import { app, BrowserWindow, shell, nativeImage, nativeTheme, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const APP_DATA_NAME = 'Accomplish';
app.setPath('userData', path.join(app.getPath('appData'), APP_DATA_NAME));

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.accomplish.desktop');
}

import { getLogCollector, initializeLogCollector } from './logging';
import { clearSecureStorage } from './store/secureStorage';
import { resetStorageSingleton } from './store/storage';
import { startApp } from './app-startup';
import { shutdownApp } from './app-shutdown';
import {
  handleProtocolUrlFromArgs,
  registerProtocolEventHandlers,
  registerAppIpcHandlers,
  handleSecondInstanceProtocolUrl,
} from './protocol-handlers';

function logMain(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(level, 'main', msg, data);
    }
  } catch (_e) {
    /* best-effort logging */
  }
}

if (process.argv.includes('--e2e-skip-auth')) {
  (global as Record<string, unknown>).E2E_SKIP_AUTH = true;
}
if (process.argv.includes('--e2e-mock-tasks') || process.env.E2E_MOCK_TASK_EVENTS === '1') {
  (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS = true;
}

if (process.env.CLEAN_START === '1') {
  const userDataPath = app.getPath('userData');
  logMain('INFO', `[Clean Mode] Clearing userData directory: ${userDataPath}`);
  try {
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      logMain('INFO', '[Clean Mode] Successfully cleared userData');
    }
  } catch (err) {
    logMain('ERROR', '[Clean Mode] Failed to clear userData', { err: String(err) });
  }
  clearSecureStorage(); // Clear before reset to avoid singleton re-creation
  resetStorageSingleton();
  logMain('INFO', '[Clean Mode] All singletons reset');
}

app.setName('Accomplish');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../../.env');
config({ path: envPath });

process.env.APP_ROOT = path.join(__dirname, '../..');
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');

const ROUTER_URL = process.env.ACCOMPLISH_ROUTER_URL;
const WEB_DIST = app.isPackaged // In production, web's build output is an extraResource.
  ? path.join(process.resourcesPath, 'web-ui')
  : path.join(process.env.APP_ROOT, '../web/dist/client');

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const isQuittingRef = {
  get value() {
    return isQuitting;
  },
  set value(v: boolean) {
    isQuitting = v;
  },
};

function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.cjs');
}

function createWindow() {
  logMain('INFO', '[Main] Creating main application window');
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, iconFile)
    : path.join(process.env.APP_ROOT!, 'resources', iconFile);
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && app.dock && !icon.isEmpty()) {
    app.dock.setIcon(icon);
  }

  const preloadPath = getPreloadPath();
  logMain('INFO', `[Main] Using preload script: ${preloadPath}`);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Accomplish',
    icon: icon.isEmpty() ? undefined : icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#f9f9f9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) {
      return;
    }
    const items: Electron.MenuItemConstructorOptions[] = [
      ...params.dictionarySuggestions.map((s) => ({
        label: s,
        click: () => mainWindow?.webContents.replaceMisspelling(s),
      })),
      ...(params.dictionarySuggestions.length > 0 ? [{ type: 'separator' as const }] : []),
      {
        label: 'Add to Dictionary',
        click: () =>
          mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      },
    ];
    Menu.buildFromTemplate(items).popup();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.maximize();

  const isE2EMode = (global as Record<string, unknown>).E2E_SKIP_AUTH === true;
  if (!app.isPackaged && !isE2EMode && process.env.NODE_ENV !== 'test') {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  // dev mode needs 'unsafe-inline' for @vitejs/plugin-react HMR preamble (never distributed)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = app.isPackaged ? "'self'" : "'self' 'unsafe-inline'";
    const csp = `default-src 'self' https:; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: ws: wss:; font-src 'self' https: data:; worker-src 'self' blob:`;
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  if (ROUTER_URL) {
    logMain('INFO', `[Main] Loading from router URL: ${ROUTER_URL}`);
    mainWindow.loadURL(ROUTER_URL);
  } else {
    const indexPath = path.join(WEB_DIST, 'index.html');
    logMain('INFO', `[Main] Loading from file: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }
}

process.on('uncaughtException', (error) => {
  try {
    getLogCollector()?.log?.('ERROR', 'main', `Uncaught exception: ${error.message}`, {
      name: error.name,
      stack: error.stack,
    });
  } catch {
    /* ignore */
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    getLogCollector()?.log?.('ERROR', 'main', 'Unhandled promise rejection', { reason });
  } catch {
    /* ignore */
  }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  logMain('INFO', '[Main] Second instance attempted; quitting');
  app.quit();
} else {
  initializeLogCollector();
  getLogCollector().logEnv('INFO', 'App starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  });

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      logMain('INFO', '[Main] Focused existing instance after second-instance event');
      handleSecondInstanceProtocolUrl(mainWindow, commandLine);
    }
  });

  app.whenReady().then(async () => {
    await startApp(createWindow, () => mainWindow, isQuittingRef);
  });
}

// With system tray, the app stays alive when all windows are closed.
app.on('window-all-closed', () => {
  logMain('INFO', '[Main] All windows closed — app continues in system tray');
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  event.preventDefault();
  let logger: ReturnType<typeof getLogCollector> | null = null;
  try {
    logger = getLogCollector();
  } catch {
    /* logger may not be initialized on early quit paths */
  }
  void shutdownApp(logger);
});

if (process.platform === 'win32' && !app.isPackaged) {
  app.setAsDefaultProtocolClient('accomplish', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('accomplish');
}

handleProtocolUrlFromArgs(() => mainWindow);
registerProtocolEventHandlers(() => mainWindow);
registerAppIpcHandlers();
