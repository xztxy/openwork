import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { TEST_TIMEOUTS } from '../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Custom fixtures for Electron smoke testing.
 * Same as electron-app but WITHOUT mock task events — runs real pipeline.
 */
type ElectronFixtures = {
  /** The Electron application instance */
  electronApp: ElectronApplication;
  /** The main renderer window (not DevTools) */
  window: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const mainPath = resolve(__dirname, '../../dist-electron/main/index.js');

    const app = await electron.launch({
      args: [
        mainPath,
        '--e2e-skip-auth',
        ...(process.env.DOCKER_ENV === '1' ? ['--no-sandbox', '--disable-gpu'] : []),
      ],
      env: {
        ...process.env,
        E2E_SKIP_AUTH: '1',
        NODE_ENV: 'test',
      },
    });

    await use(app);

    await app.close();
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.APP_RESTART));
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    await window.waitForLoadState('load');

    await window.waitForSelector('[data-testid="task-input-textarea"]', {
      state: 'visible',
      timeout: TEST_TIMEOUTS.NAVIGATION,
    });

    await use(window);
  },
});

export { expect } from '@playwright/test';
