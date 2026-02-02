/**
 * Utility module for accessing bundled Node.js binaries.
 *
 * The app bundles standalone Node.js v20.18.1 binaries to ensure
 * MCP servers and CLI tools work regardless of the user's system configuration.
 *
 * This module accepts PlatformConfig instead of using Electron APIs directly,
 * making it usable in both Electron and non-Electron contexts.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { PlatformConfig, BundledNodePaths } from '../types.js';

/**
 * Extended BundledNodePaths with the Node.js installation root directory.
 */
export interface BundledNodePathsExtended extends BundledNodePaths {
  /** Root directory of the Node.js installation */
  nodeDir: string;
}

/**
 * Get paths to the bundled Node.js binaries.
 *
 * In packaged apps, returns paths to the bundled Node.js installation.
 * In development mode (isPackaged=false), returns null (use system Node.js).
 *
 * @param config - The platform configuration
 * @returns Paths to bundled Node.js binaries, or null if not available
 */
export function getBundledNodePaths(config: PlatformConfig): BundledNodePathsExtended | null {
  if (!config.isPackaged) {
    // In development, use system Node
    return null;
  }

  if (!config.resourcesPath) {
    // No resources path configured, can't find bundled Node
    return null;
  }

  const platform = config.platform;
  const arch = config.arch;

  const isWindows = platform === 'win32';
  const ext = isWindows ? '.exe' : '';
  const scriptExt = isWindows ? '.cmd' : '';

  // Node.js directory is architecture-specific
  const nodeDir = path.join(config.resourcesPath, 'nodejs', arch);

  const binDir = isWindows ? nodeDir : path.join(nodeDir, 'bin');

  return {
    nodePath: path.join(binDir, `node${ext}`),
    npmPath: path.join(binDir, `npm${scriptExt}`),
    npxPath: path.join(binDir, `npx${scriptExt}`),
    binDir,
    nodeDir,
  };
}

/**
 * Check if bundled Node.js is available and accessible.
 *
 * @param config - The platform configuration
 * @returns true if bundled Node.js exists and is accessible
 */
export function isBundledNodeAvailable(config: PlatformConfig): boolean {
  const paths = getBundledNodePaths(config);
  if (!paths) {
    return false;
  }
  return fs.existsSync(paths.nodePath);
}

/**
 * Get the node binary path (bundled or system fallback).
 *
 * In packaged apps, returns the bundled node path.
 * In development or if bundled node is unavailable, returns 'node' to use system PATH.
 *
 * @param config - The platform configuration
 * @returns Absolute path to node binary or 'node' for system fallback
 */
export function getNodePath(config: PlatformConfig): string {
  const bundled = getBundledNodePaths(config);
  if (bundled && fs.existsSync(bundled.nodePath)) {
    return bundled.nodePath;
  }
  // Warn if falling back to system node in packaged app (unexpected)
  if (config.isPackaged) {
    console.warn('[Bundled Node] WARNING: Bundled Node.js not found, falling back to system node');
  }
  return 'node'; // Fallback to system node
}

/**
 * Get the npm binary path (bundled or system fallback).
 *
 * @param config - The platform configuration
 * @returns Absolute path to npm binary or 'npm' for system fallback
 */
export function getNpmPath(config: PlatformConfig): string {
  const bundled = getBundledNodePaths(config);
  if (bundled && fs.existsSync(bundled.npmPath)) {
    return bundled.npmPath;
  }
  if (config.isPackaged) {
    console.warn('[Bundled Node] WARNING: Bundled npm not found, falling back to system npm');
  }
  return 'npm'; // Fallback to system npm
}

/**
 * Get the npx binary path (bundled or system fallback).
 *
 * @param config - The platform configuration
 * @returns Absolute path to npx binary or 'npx' for system fallback
 */
export function getNpxPath(config: PlatformConfig): string {
  const bundled = getBundledNodePaths(config);
  if (bundled && fs.existsSync(bundled.npxPath)) {
    return bundled.npxPath;
  }
  if (config.isPackaged) {
    console.warn('[Bundled Node] WARNING: Bundled npx not found, falling back to system npx');
  }
  return 'npx'; // Fallback to system npx
}

/**
 * Log information about the bundled Node.js for debugging.
 *
 * @param config - The platform configuration
 */
export function logBundledNodeInfo(config: PlatformConfig): void {
  const paths = getBundledNodePaths(config);

  if (!paths) {
    console.log('[Bundled Node] Development mode - using system Node.js');
    return;
  }

  console.log('[Bundled Node] Configuration:');
  console.log(`  Platform: ${config.platform}`);
  console.log(`  Architecture: ${config.arch}`);
  console.log(`  Node directory: ${paths.nodeDir}`);
  console.log(`  Node path: ${paths.nodePath}`);
  console.log(`  Available: ${fs.existsSync(paths.nodePath)}`);
}
