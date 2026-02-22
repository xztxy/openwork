import { serve } from '@/index.js';
import { execFileSync, execSync } from 'child_process';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDataDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'Accomplish', 'dev-browser');
  } else if (process.platform === 'win32') {
    return join(process.env.APPDATA || homeDir, 'Accomplish', 'dev-browser');
  } else {
    return join(homeDir, '.accomplish', 'dev-browser');
  }
}

const dataDir = getDataDir();
const tmpDir = join(dataDir, 'tmp');
const profileDir = process.env.DEV_BROWSER_PROFILE || join(dataDir, 'profiles');

console.log(`Creating data directory: ${dataDir}`);
mkdirSync(tmpDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });

const ACCOMPLISH_HTTP_PORT = parseInt(process.env.DEV_BROWSER_PORT || '9224', 10);
const ACCOMPLISH_CDP_PORT = parseInt(process.env.DEV_BROWSER_CDP_PORT || '9225', 10);
const DEV_BROWSER_ROOT = join(__dirname, '..');

function runWindowsPowerShell(command: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function findListeningPidOnWindows(port: number): number | null {
  try {
    const output = runWindowsPowerShell(
      `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $conn) { $conn.OwningProcess }`,
    );
    if (!output) return null;
    const pid = Number.parseInt(output, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function stopProcessOnWindows(pid: number): void {
  runWindowsPowerShell(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
}

if (
  !Number.isFinite(ACCOMPLISH_HTTP_PORT) ||
  ACCOMPLISH_HTTP_PORT < 1 ||
  ACCOMPLISH_HTTP_PORT > 65535
) {
  throw new Error(
    `Invalid DEV_BROWSER_PORT: ${process.env.DEV_BROWSER_PORT}. Must be a number between 1 and 65535`,
  );
}
if (
  !Number.isFinite(ACCOMPLISH_CDP_PORT) ||
  ACCOMPLISH_CDP_PORT < 1 ||
  ACCOMPLISH_CDP_PORT > 65535
) {
  throw new Error(
    `Invalid DEV_BROWSER_CDP_PORT: ${process.env.DEV_BROWSER_CDP_PORT}. Must be a number between 1 and 65535`,
  );
}

console.log('Checking for existing servers...');
try {
  const res = await fetch(`http://localhost:${ACCOMPLISH_HTTP_PORT}`, {
    signal: AbortSignal.timeout(1000),
  });
  if (res.ok) {
    const info = (await res.json()) as { mode?: string };

    if (info.mode === 'extension') {
      console.log('Found relay server running, killing to start launch server...');
      try {
        if (process.platform === 'win32') {
          const pid = findListeningPidOnWindows(ACCOMPLISH_HTTP_PORT);
          if (pid) {
            stopProcessOnWindows(pid);
          }
        } else {
          const pid = execSync(`lsof -ti:${ACCOMPLISH_HTTP_PORT}`, { encoding: 'utf-8' }).trim();
          if (pid) {
            execSync(`kill -9 ${pid}`);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // intentionally empty
      }
    } else {
      console.log(`Launch server already running on port ${ACCOMPLISH_HTTP_PORT}`);
      process.exit(0);
    }
  }
} catch {
  // intentionally empty
}

try {
  if (process.platform === 'win32') {
    const pid = findListeningPidOnWindows(ACCOMPLISH_CDP_PORT);
    if (pid) {
      console.log(
        `Cleaning up stale Chrome process on CDP port ${ACCOMPLISH_CDP_PORT} (PID: ${pid})`,
      );
      stopProcessOnWindows(pid);
    }
  } else {
    const pid = execSync(`lsof -ti:${ACCOMPLISH_CDP_PORT}`, { encoding: 'utf-8' }).trim();
    if (pid) {
      console.log(
        `Cleaning up stale Chrome process on CDP port ${ACCOMPLISH_CDP_PORT} (PID: ${pid})`,
      );
      execSync(`kill -9 ${pid}`);
    }
  }
} catch {
  // intentionally empty
}

const profileDirs = [join(profileDir, 'chrome-profile'), join(profileDir, 'playwright-profile')];
const staleLockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
for (const dir of profileDirs) {
  for (const lockFile of staleLockFiles) {
    const lockPath = join(dir, lockFile);
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
        console.log(`Cleaned up stale lock file: ${lockFile} in ${dir}`);
      } catch (err) {
        console.warn(`Failed to remove ${lockFile}:`, err);
      }
    }
  }
}

function installPlaywrightChromium(): void {
  console.log('\n========================================');
  console.log('Downloading browser (one-time setup)...');
  console.log('This may take 1-2 minutes.');
  console.log('========================================\n');

  const playwrightCliPath = join(DEV_BROWSER_ROOT, 'node_modules', 'playwright', 'cli.js');
  if (!existsSync(playwrightCliPath)) {
    throw new Error(
      `Playwright CLI not found at ${playwrightCliPath}. Run package install before starting.`,
    );
  }

  console.log(`Using bundled Playwright CLI: ${playwrightCliPath}`);
  execFileSync(process.execPath, [playwrightCliPath, 'install', 'chromium'], {
    cwd: DEV_BROWSER_ROOT,
    stdio: 'inherit',
  });
  console.log('\nBrowser installed successfully!\n');
}

console.log('Starting dev browser server...');
const headless = process.env.HEADLESS === 'true';

async function startServer(retry = false): Promise<void> {
  try {
    const server = await serve({
      port: ACCOMPLISH_HTTP_PORT,
      cdpPort: ACCOMPLISH_CDP_PORT,
      headless,
      profileDir,
      useSystemChrome: true,
    });

    console.log(`Dev browser server started`);
    console.log(`  WebSocket: ${server.wsEndpoint}`);
    console.log(`  Tmp directory: ${tmpDir}`);
    console.log(`  Profile directory: ${profileDir}`);
    console.log(`\nReady`);
    console.log(`\nPress Ctrl+C to stop`);

    await new Promise(() => {});
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const isBrowserMissing =
      errorMessage.includes("Executable doesn't exist") ||
      errorMessage.includes('browserType.launchPersistentContext') ||
      errorMessage.includes('npx playwright install') ||
      errorMessage.includes('run the install command');

    if (isBrowserMissing && !retry) {
      console.log('\nSystem Chrome not available, downloading Playwright Chromium...');
      try {
        installPlaywrightChromium();
        await startServer(true);
        return;
      } catch (installError) {
        console.error('Failed to install Playwright browsers:', installError);
        console.log(
          'You may need to run manually: node node_modules/playwright/cli.js install chromium',
        );
        process.exit(1);
      }
    }

    console.error('Failed to start dev browser server:', error);
    process.exit(1);
  }
}

await startServer();
