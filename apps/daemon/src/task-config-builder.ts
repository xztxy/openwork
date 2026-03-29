/**
 * Environment and CLI configuration builders for TaskService.
 * Extracted to keep task-service.ts under 200 lines.
 *
 * NO electron imports — this runs as plain Node.js.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildCliArgs as coreBuildCliArgs,
  buildOpenCodeEnvironment,
  resolveCliPath,
  isCliAvailable as coreIsCliAvailable,
  generateConfig,
  buildProviderConfigs,
  syncApiKeysToOpenCodeAuth,
  getOpenCodeAuthPath,
  getBundledNodePaths,
  DEV_BROWSER_PORT,
  type TaskConfig,
  type StorageAPI,
  type EnvironmentConfig,
  type CliResolverConfig,
  type BrowserServerConfig,
  type BedrockCredentials,
} from '@accomplish_ai/agent-core';

export interface TaskConfigBuilderOptions {
  userDataPath: string;
  mcpToolsPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}

export function getCliCommand(opts: TaskConfigBuilderOptions): { command: string; args: string[] } {
  const cliConfig: CliResolverConfig = {
    isPackaged: opts.isPackaged,
    resourcesPath: opts.resourcesPath,
    appPath: opts.appPath,
  };
  const resolved = resolveCliPath(cliConfig);
  if (resolved) {
    return { command: resolved.cliPath, args: [] };
  }
  if (process.platform === 'win32') {
    throw new Error('Failed to resolve OpenCode CLI executable on Windows');
  }
  return { command: 'opencode', args: [] };
}

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

export async function buildEnvironment(
  taskId: string,
  storage: StorageAPI,
  _opts: TaskConfigBuilderOptions,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const apiKeys = await storage.getAllApiKeys();
  const bedrockCredentials = storage.getBedrockCredentials() as BedrockCredentials | null;
  const activeModel = storage.getActiveProviderModel();
  const selectedModel = storage.getSelectedModel();
  let ollamaHost: string | undefined;
  if (activeModel?.provider === 'ollama' && activeModel.baseUrl) {
    ollamaHost = activeModel.baseUrl;
  } else if (selectedModel?.provider === 'ollama' && selectedModel.baseUrl) {
    ollamaHost = selectedModel.baseUrl;
  }
  const envConfig: EnvironmentConfig = {
    apiKeys,
    bedrockCredentials: bedrockCredentials || undefined,
    taskId: taskId || undefined,
    ollamaHost,
  };
  return buildOpenCodeEnvironment(env, envConfig);
}

export async function buildCliArgs(config: TaskConfig, storage: StorageAPI): Promise<string[]> {
  const activeModel = storage.getActiveProviderModel();
  const selectedModel = activeModel || storage.getSelectedModel();
  return coreBuildCliArgs({
    prompt: config.prompt,
    sessionId: config.sessionId,
    selectedModel: selectedModel
      ? { provider: selectedModel.provider, model: selectedModel.model }
      : null,
  });
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
): Promise<void> {
  const authPath = getOpenCodeAuthPath();
  const apiKeys = await storage.getAllApiKeys();
  await syncApiKeysToOpenCodeAuth(authPath, apiKeys);

  const { providerConfigs, enabledProviders, modelOverride } = await buildProviderConfigs({
    getApiKey: (provider) => storage.getApiKey(provider),
  });

  const permissionApiPort = process.env.ACCOMPLISH_PERMISSION_API_PORT
    ? parseInt(process.env.ACCOMPLISH_PERMISSION_API_PORT, 10)
    : undefined;
  const questionApiPort = process.env.ACCOMPLISH_QUESTION_API_PORT
    ? parseInt(process.env.ACCOMPLISH_QUESTION_API_PORT, 10)
    : undefined;

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
    authToken: process.env.ACCOMPLISH_DAEMON_AUTH_TOKEN,
    model: modelOverride?.model,
    smallModel: modelOverride?.smallModel,
  });

  process.env.OPENCODE_CONFIG = result.configPath;
  process.env.OPENCODE_CONFIG_DIR = path.dirname(result.configPath);
}

export function getBrowserServerConfig(opts: TaskConfigBuilderOptions): BrowserServerConfig {
  return {
    mcpToolsPath: opts.mcpToolsPath,
    bundledNodeBinPath: getBundledNodeBinPath(opts),
    devBrowserPort: DEV_BROWSER_PORT,
  };
}

export { createTaskCallbacks } from './task-callbacks.js';
