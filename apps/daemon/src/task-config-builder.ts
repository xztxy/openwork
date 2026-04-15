/**
 * Environment and CLI configuration builders for TaskService.
 * Extracted to keep task-service.ts under 200 lines.
 *
 * NO electron imports — this runs as plain Node.js.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isCliAvailable as coreIsCliAvailable,
  generateConfig,
  buildProviderConfigs,
  syncApiKeysToOpenCodeAuth,
  getOpenCodeAuthJsonPath,
  getBundledNodePaths,
  getEnabledSkills,
  type StorageAPI,
  type CliResolverConfig,
  type AccomplishRuntime,
} from '@accomplish_ai/agent-core';

export interface TaskConfigBuilderOptions {
  userDataPath: string;
  mcpToolsPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  accomplishRuntime?: AccomplishRuntime;
}

// Phase 4b of the OpenCode SDK cutover port removed the dead `getCliCommand`,
// `buildEnvironment`, and `buildCliArgs` helpers. The SDK adapter no longer
// spawns a CLI per task — `OpenCodeServerManager` runs `opencode serve`
// directly via `child_process.spawn` and the SDK uses HTTP. The
// per-task spawn environment is built inside the server-manager itself.

export function getBundledNodeBinPath(opts: TaskConfigBuilderOptions): string | undefined {
  const paths = getBundledNodePaths({
    isPackaged: opts.isPackaged,
    resourcesPath: opts.resourcesPath,
    appPath: opts.appPath,
    userDataPath: opts.userDataPath,
    tempPath: tmpdir(),
    platform: process.platform,
    arch: process.arch,
  });
  return paths?.binDir;
}

export async function isCliAvailable(opts: TaskConfigBuilderOptions): Promise<boolean> {
  const cliConfig: CliResolverConfig = {
    isPackaged: opts.isPackaged,
    resourcesPath: opts.resourcesPath,
    appPath: opts.appPath,
  };
  return coreIsCliAvailable(cliConfig);
}

export async function onBeforeStart(
  storage: StorageAPI,
  opts: TaskConfigBuilderOptions,
): Promise<{ configPath: string; env: NodeJS.ProcessEnv }> {
  const authPath = getOpenCodeAuthJsonPath();
  const apiKeys = await storage.getAllApiKeys();
  await syncApiKeysToOpenCodeAuth(authPath, apiKeys);

  const { providerConfigs, enabledProviders, modelOverride } = await buildProviderConfigs({
    getApiKey: (provider) => storage.getApiKey(provider),
    accomplishRuntime: opts.accomplishRuntime,
    accomplishStorageDeps: {
      readKey: (key) => storage.get(key),
      writeKey: (key, value) => storage.set(key, value),
      readGaClientId: () => null, // GA client ID not available in daemon — fingerprint fallback used
    },
  });

  const getPort = (envVar: string) => {
    const val = process.env[envVar];
    if (!val) {
      return undefined;
    }
    const parsed = parseInt(val, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const permissionApiPort = getPort('ACCOMPLISH_PERMISSION_API_PORT');
  const questionApiPort = getPort('ACCOMPLISH_QUESTION_API_PORT');
  const whatsappApiPort = getPort('ACCOMPLISH_WHATSAPP_API_PORT');

  const skills = getEnabledSkills();

  const result = generateConfig({
    platform: process.platform,
    mcpToolsPath: opts.mcpToolsPath,
    userDataPath: opts.userDataPath,
    isPackaged: opts.isPackaged,
    bundledNodeBinPath: getBundledNodeBinPath(opts),
    providerConfigs,
    enabledProviders,
    permissionApiPort,
    questionApiPort,
    whatsappApiPort,
    authToken: process.env.ACCOMPLISH_DAEMON_AUTH_TOKEN,
    model: modelOverride?.model,
    smallModel: modelOverride?.smallModel,
    skills,
  });

  return {
    configPath: result.configPath,
    env: {
      OPENCODE_CONFIG: result.configPath,
      OPENCODE_CONFIG_DIR: path.dirname(result.configPath),
    },
  };
}
export * from './task-service-helpers.js';
export { createTaskCallbacks } from './task-callbacks.js';
