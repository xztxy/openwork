import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import type { CliResolverConfig, ResolvedCliPaths } from '../types.js';

function getOpenCodePlatformInfo(): { packageName: string; binaryName: string } {
  if (process.platform === 'win32') {
    return {
      packageName: 'opencode-windows-x64',
      binaryName: 'opencode.exe',
    };
  }
  return {
    packageName: 'opencode-ai',
    binaryName: 'opencode',
  };
}

function getWindowsNodeModulesExeCandidates(basePath: string): string[] {
  return [
    path.join(basePath, 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe'),
    path.join(basePath, 'node_modules', 'opencode-windows-x64-baseline', 'bin', 'opencode.exe'),
    path.join(
      basePath,
      'node_modules',
      'opencode-ai',
      'node_modules',
      'opencode-windows-x64',
      'bin',
      'opencode.exe',
    ),
    path.join(
      basePath,
      'node_modules',
      'opencode-ai',
      'node_modules',
      'opencode-windows-x64-baseline',
      'bin',
      'opencode.exe',
    ),
  ];
}

function getUnixNodeModulesCliCandidates(basePath: string): string[] {
  return [
    path.join(basePath, 'node_modules', '.bin', 'opencode'),
    path.join(basePath, 'node_modules', 'opencode-ai', 'bin', 'opencode'),
  ];
}

function getFirstExistingPath(paths: string[]): string | null {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveCliPath(config: CliResolverConfig): ResolvedCliPaths | null {
  const { isPackaged, resourcesPath, appPath } = config;

  if (isPackaged && resourcesPath) {
    const { packageName, binaryName } = getOpenCodePlatformInfo();

    const cliPath = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      packageName,
      'bin',
      binaryName,
    );

    if (fs.existsSync(cliPath)) {
      return {
        cliPath,
        cliDir: path.dirname(cliPath),
        source: 'bundled',
      };
    }

    return null;
  }

  if (process.platform === 'win32') {
    const localExeCandidates = appPath ? getWindowsNodeModulesExeCandidates(appPath) : [];
    const localExePath = getFirstExistingPath(localExeCandidates);

    if (localExePath) {
      console.log('[CLI Resolver] Using local OpenCode CLI executable:', localExePath);
      return {
        cliPath: localExePath,
        cliDir: path.dirname(localExePath),
        source: 'local',
      };
    }

    return null;
  }

  const localCliCandidates = appPath ? getUnixNodeModulesCliCandidates(appPath) : [];
  const localCliPath = getFirstExistingPath(localCliCandidates);

  if (localCliPath) {
    console.log('[CLI Resolver] Using local OpenCode CLI:', localCliPath);
    return {
      cliPath: localCliPath,
      cliDir: path.dirname(localCliPath),
      source: 'local',
    };
  }

  return null;
}

export function isCliAvailable(config: CliResolverConfig): boolean {
  return resolveCliPath(config) !== null;
}

export async function getCliVersion(cliPath: string): Promise<string | null> {
  try {
    if (cliPath.includes('node_modules')) {
      const { packageName } = getOpenCodePlatformInfo();
      const packageJsonCandidates = [
        path.join(path.dirname(path.dirname(cliPath)), packageName, 'package.json'),
        path.join(path.dirname(path.dirname(cliPath)), 'package.json'),
      ];

      for (const packageJsonPath of packageJsonCandidates) {
        if (fs.existsSync(packageJsonPath)) {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          return pkg.version;
        }
      }
    }

    const fullCommand = `"${cliPath}" --version`;

    const output = execSync(fullCommand, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : output;
  } catch {
    return null;
  }
}
