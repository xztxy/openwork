#!/usr/bin/env node
/**
 * Cross-platform dev-browser server launcher.
 * Replaces server.sh for Windows compatibility.
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const skillDir = __dirname;
const isWindows = process.platform === 'win32';

// Parse command line arguments
const headless = process.argv.includes('--headless');

// Determine npm/npx paths - prefer bundled Node.js if available
let npmCommand = isWindows ? 'npm.cmd' : 'npm';
let npxCommand = isWindows ? 'npx.cmd' : 'npx';
if (process.env.NODE_BIN_PATH) {
  npmCommand = path.join(process.env.NODE_BIN_PATH, isWindows ? 'npm.cmd' : 'npm');
  npxCommand = path.join(process.env.NODE_BIN_PATH, isWindows ? 'npx.cmd' : 'npx');
}

// Check if node_modules exists - install if missing
const nodeModulesPath = path.join(skillDir, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('Dependencies not found. Installing...');
  const result = spawnSync(npmCommand, ['install'], {
    cwd: skillDir,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (result.error || result.status !== 0) {
    console.error('Failed to install dependencies');
    process.exit(1);
  }
}

// Build environment
const env = { ...process.env };
if (headless) {
  env.HEADLESS = 'true';
}

console.log('Starting dev-browser server...');

const child = spawn(npxCommand, ['tsx', 'scripts/start-server.ts'], {
  cwd: skillDir,
  stdio: 'inherit',
  env,
  shell: isWindows,
});

child.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code || 0);
});
