#!/usr/bin/env node
/**
 * Cross-platform Vite starter for desktop app
 * Sets ACCOMPLISH_ROUTER_URL environment variable and starts Vite.
 *
 * Contributed by shiv669 (PR #590 feat/integrations-whatsapp-400).
 * Fixes Windows compatibility where inline env var assignment (VAR=value cmd)
 * doesn't work — uses process.env instead.
 */

const { spawn } = require('child_process');
const path = require('path');

// Set the environment variable for all platforms
process.env.ACCOMPLISH_ROUTER_URL = 'http://localhost:5173';

// Ensure System32 is in PATH on Windows so vite-plugin-electron can use taskkill
if (process.platform === 'win32') {
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const currentPath = process.env.PATH || '';
  if (!currentPath.toLowerCase().includes(sys32.toLowerCase())) {
    process.env.PATH = `${sys32};${currentPath}`;
  }
}

console.log('[dev-vite] Starting Vite with ACCOMPLISH_ROUTER_URL=http://localhost:5173');

// Spawn vite process from the correct directory
const desktopDir = path.resolve(__dirname, '..');
const vite = spawn('vite', [], {
  stdio: 'inherit',
  shell: true,
  cwd: desktopDir,
  env: process.env,
});

vite.on('error', (err) => {
  console.error('[dev-vite] Failed to start Vite:', err);
  process.exit(1);
});

vite.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[dev-vite] Vite terminated by signal: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
