/**
 * Cross-platform dev start script for Electron.
 *
 * Replaces the inline package.json "dev" script which used Unix-only syntax.
 * - Skips electron-rebuild on Windows (postinstall handles prebuilts)
 * - Sets ACCOMPLISH_ROUTER_URL for Vite
 * - Supports --clean flag to set CLEAN_START=1
 * - Supports --vite-only flag to skip rebuild/patch steps (used by dev:clean)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const cwd = path.join(__dirname, '..');
const shell = isWin ? 'powershell.exe' : true;
const isClean = process.argv.includes('--clean');
const viteOnly = process.argv.includes('--vite-only');

function run(command, description) {
  console.log(`> ${description}`);
  execSync(command, { stdio: 'inherit', cwd, shell });
}

if (!viteOnly) {
  // 1. Patch Electron name (macOS only, no-ops on Windows)
  run('node scripts/patch-electron-name.cjs', 'Patching Electron name');

  // 2. Rebuild native modules (skip on Windows — postinstall handles prebuilts)
  if (!isWin) {
    run('npx electron-rebuild -f', 'Rebuilding native modules for Electron');
  }

  // 3. Clean dist-electron
  const distElectron = path.join(cwd, 'dist-electron');
  fs.rmSync(distElectron, { recursive: true, force: true });
  console.log('> Cleaned dist-electron');
}

// 4. Start Vite with router URL
const env = {
  ...process.env,
  ACCOMPLISH_ROUTER_URL: 'http://localhost:5173',
  ...(isClean ? { CLEAN_START: '1' } : {}),
};

const result = spawnSync('npx', ['vite'], {
  stdio: 'inherit',
  cwd,
  env,
  shell,
});

process.exit(result.status ?? 1);
