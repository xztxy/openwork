/**
 * Custom postinstall script for the desktop app.
 *
 * Phase 4c of the OpenCode SDK cutover port removed `node-pty`. The legacy
 * reasons to skip electron-rebuild on Windows (node-pty's prebuilt binaries
 * tripping up electron-rebuild, Spectre mitigation, pnpm's 260-char path
 * limit) no longer apply — the only Electron-native module the desktop now
 * ships is `better-sqlite3`. We still install an Electron-compatible
 * better-sqlite3 prebuild on Windows for compatibility with packaged mode.
 *
 * On macOS/Linux, we run electron-rebuild normally.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Prevent infinite recursion when npm install triggers parent postinstall
// This happens on Windows where npm walks up to find package.json
if (process.env.ACCOMPLISH_POSTINSTALL_RUNNING) {
  console.log('> Postinstall already running, skipping nested invocation');
  process.exit(0);
}
process.env.ACCOMPLISH_POSTINSTALL_RUNNING = '1';

const isWindows = process.platform === 'win32';

function runCommand(command, description) {
  console.log(`\n> ${description}...`);
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      shell: true,
      env: {
        ...process.env,
        ACCOMPLISH_POSTINSTALL_RUNNING: '1',
      },
    });
  } catch (error) {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

if (isWindows) {
  // On Windows, install an Electron-compatible prebuilt for better-sqlite3.
  // (Phase 4c: `node-pty` no longer ships, so the verify-prebuilds step for
  // it is gone too.)
  console.log('\n> Windows: Installing Electron-compatible better-sqlite3 prebuild...');

  // Get the Electron version from package.json
  const packageJson = require('../package.json');
  const electronVersion = packageJson.devDependencies?.electron?.replace('^', '') || '35.0.0';
  console.log(`> Electron version: ${electronVersion}`);

  // Find better-sqlite3 in pnpm store and install Electron prebuild
  const betterSqlite3Path = findBetterSqlite3();
  if (betterSqlite3Path) {
    console.log(`> Found better-sqlite3 at: ${betterSqlite3Path}`);
    try {
      // Remove existing build to force prebuild-install to run
      const buildPath = path.join(betterSqlite3Path, 'build');
      if (fs.existsSync(buildPath)) {
        fs.rmSync(buildPath, { recursive: true, force: true });
      }

      // Use prebuild-install to get Electron-compatible binary
      execSync(`npx prebuild-install --runtime electron --target ${electronVersion}`, {
        stdio: 'inherit',
        cwd: betterSqlite3Path,
        shell: true,
      });
      console.log('> better-sqlite3 Electron prebuild installed successfully');
    } catch (error) {
      console.error('> Failed to install better-sqlite3 prebuild:', error.message);
      console.error('> The app may not work correctly in packaged mode.');
      // Don't exit - the app might still work in development
    }
  } else {
    console.warn('> Warning: better-sqlite3 not found, skipping prebuild installation');
  }

  // Phase 4c: node-pty prebuild verification dropped with the dependency.
} else {
  // On macOS/Linux, run electron-rebuild first (matches original behavior)
  runCommand('npx electron-rebuild', 'Running electron-rebuild');
}

const useBundledMcp = process.env.ACCOMPLISH_BUNDLED_MCP === '1' || process.env.CI === 'true';

// Install shared MCP tools runtime dependencies (Playwright) at mcp-tools/ root
// MCP tools are now in packages/agent-core/mcp-tools
const mcpToolsPath = path.join(__dirname, '..', '..', '..', 'packages', 'agent-core', 'mcp-tools');
runCommand(
  `npm --prefix "${mcpToolsPath}" install --omit=dev --no-package-lock`,
  'Installing shared MCP tools runtime dependencies',
);

// Install per-tool dependencies for dev/tsx workflows
if (!useBundledMcp) {
  // Install ALL dependencies (including devDependencies) during development
  // because esbuild needs them for bundling. The bundle-skills.cjs script
  // will reinstall with --omit=dev during packaged builds.
  // Phase 3 of the SDK cutover port removed `file-permission` and
  // `ask-user-question` MCP packages — don't try to install their deps.
  const tools = ['dev-browser', 'dev-browser-mcp', 'complete-task', 'start-task'];
  for (const tool of tools) {
    runCommand(
      `npm --prefix "${mcpToolsPath}/${tool}" install --no-package-lock`,
      `Installing ${tool} dependencies`,
    );
  }
}

console.log('\n> Postinstall complete!');

function findBetterSqlite3() {
  return findPackage('better-sqlite3');
}

function findPackage(packageName) {
  // Try to find package in node_modules (may be a symlink in pnpm)
  const directPath = path.join(__dirname, '..', 'node_modules', packageName);
  if (fs.existsSync(directPath)) {
    // Resolve symlink to get actual path
    const realPath = fs.realpathSync(directPath);
    return realPath;
  }

  // Look in pnpm's .pnpm directory
  const pnpmPath = path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmPath)) {
    const entries = fs.readdirSync(pnpmPath);
    for (const entry of entries) {
      if (entry.startsWith(`${packageName}@`)) {
        const packageDir = path.join(pnpmPath, entry, 'node_modules', packageName);
        if (fs.existsSync(packageDir)) {
          return packageDir;
        }
      }
    }
  }

  return null;
}
