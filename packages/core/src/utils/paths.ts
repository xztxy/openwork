/**
 * Platform-independent path utilities
 *
 * Provides functions for resolving user data paths, temp paths,
 * and creating platform configurations without Electron dependencies.
 */

import * as os from 'os';
import * as path from 'path';
import type { PlatformConfig } from '../types.js';

/**
 * Get the default user data path for the given app name.
 *
 * Platform-specific paths:
 * - macOS: ~/Library/Application Support/<appName>
 * - Windows: %APPDATA%/<appName>
 * - Linux: ~/.config/<appName>
 *
 * @param appName - The application name
 * @returns The default user data path
 */
export function getDefaultUserDataPath(appName: string): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName);
  }
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
  }
  // Linux and other Unix-like systems
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appName);
}

/**
 * Get the default temporary directory path.
 *
 * @returns The system temporary directory
 */
export function getDefaultTempPath(): string {
  return os.tmpdir();
}

/**
 * Create a default platform configuration for the given app name.
 *
 * This is useful for CLI applications or tests that don't have access
 * to Electron's app paths.
 *
 * @param appName - The application name
 * @param overrides - Optional overrides for the default configuration
 * @returns A PlatformConfig with sensible defaults
 */
export function createDefaultPlatformConfig(
  appName: string,
  overrides?: Partial<PlatformConfig>
): PlatformConfig {
  return {
    userDataPath: getDefaultUserDataPath(appName),
    tempPath: getDefaultTempPath(),
    isPackaged: false,
    platform: process.platform,
    arch: process.arch,
    ...overrides,
  };
}

/**
 * Resolve a path relative to the user data directory.
 *
 * @param config - The platform configuration
 * @param segments - Path segments to join with the user data path
 * @returns The resolved absolute path
 */
export function resolveUserDataPath(config: PlatformConfig, ...segments: string[]): string {
  return path.join(config.userDataPath, ...segments);
}

/**
 * Resolve a path relative to the resources directory.
 *
 * @param config - The platform configuration
 * @param segments - Path segments to join with the resources path
 * @returns The resolved absolute path, or null if resourcesPath is not set
 */
export function resolveResourcesPath(
  config: PlatformConfig,
  ...segments: string[]
): string | null {
  if (!config.resourcesPath) {
    return null;
  }
  return path.join(config.resourcesPath, ...segments);
}

/**
 * Resolve a path relative to the app directory.
 *
 * @param config - The platform configuration
 * @param segments - Path segments to join with the app path
 * @returns The resolved absolute path, or null if appPath is not set
 */
export function resolveAppPath(config: PlatformConfig, ...segments: string[]): string | null {
  if (!config.appPath) {
    return null;
  }
  return path.join(config.appPath, ...segments);
}
