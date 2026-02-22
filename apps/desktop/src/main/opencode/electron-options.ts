import { app } from 'electron';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { TaskManagerOptions, TaskCallbacks } from '@accomplish_ai/agent-core';
import type { TaskConfig } from '@accomplish_ai/agent-core';
import { DEV_BROWSER_PORT } from '@accomplish_ai/agent-core';
import {
  getAzureEntraToken,
  ensureDevBrowserServer,
  resolveCliPath,
  isCliAvailable as coreIsCliAvailable,
  buildCliArgs as coreBuildCliArgs,
  buildOpenCodeEnvironment,
  type BrowserServerConfig,
  type CliResolverConfig,
  type EnvironmentConfig,
} from '@accomplish_ai/agent-core';
import { getModelDisplayName } from '@accomplish_ai/agent-core';
import type {
  AzureFoundryCredentials,
  BedrockCredentials,
  VertexCredentials,
} from '@accomplish_ai/agent-core';
import { getStorage } from '../store/storage';
import { getAllApiKeys, getBedrockCredentials, getApiKey } from '../store/secureStorage';
import {
  generateOpenCodeConfig,
  getMcpToolsPath,
  syncApiKeysToOpenCodeAuth,
} from './config-generator';
import { getExtendedNodePath, findCommandInPath } from '../utils/system-path';
import { getBundledNodePaths, logBundledNodeInfo } from '../utils/bundled-node';

const VERTEX_SA_KEY_FILENAME = 'vertex-sa-key.json';
const openCodeRuntimeStateCache: {
  runtimeDigest: string | null;
  authDigest: string | null;
  inFlightPreparation: Promise<{ configChanged: boolean }> | null;
} = {
  runtimeDigest: null,
  authDigest: null,
  inFlightPreparation: null,
};

/**
 * Removes the Vertex AI service account key file from disk if it exists.
 * Called when the Vertex provider is disconnected or the app quits.
 */
export function cleanupVertexServiceAccountKey(): void {
  try {
    const keyPath = path.join(app.getPath('userData'), VERTEX_SA_KEY_FILENAME);
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
      console.log('[Vertex] Cleaned up service account key file');
    }
  } catch (error) {
    console.warn('[Vertex] Failed to clean up service account key file:', error);
  }
}

function getCliResolverConfig(): CliResolverConfig {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  };
}

export function getOpenCodeCliPath(): { command: string; args: string[] } {
  const resolved = resolveCliPath(getCliResolverConfig());
  if (resolved) {
    return { command: resolved.cliPath, args: [] };
  }
  throw new Error(
    '[CLI Path] OpenCode CLI executable not found. Reinstall dependencies to restore platform binaries.',
  );
}

export function isOpenCodeCliAvailable(): boolean {
  return coreIsCliAvailable(getCliResolverConfig());
}

export function getBundledOpenCodeVersion(): string | null {
  if (app.isPackaged) {
    try {
      const packageName = process.platform === 'win32' ? 'opencode-windows-x64' : 'opencode-ai';
      const packageJsonPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        packageName,
        'package.json',
      );

      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return pkg.version;
      }
    } catch {
      // intentionally empty
    }
  }

  try {
    const { command } = getOpenCodeCliPath();
    const fullCommand = `"${command}" --version`;
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

export async function buildEnvironment(taskId: string): Promise<NodeJS.ProcessEnv> {
  // Start with base environment
  let env: NodeJS.ProcessEnv = { ...process.env };
  const bundledNode = getBundledNodePaths();

  if (!bundledNode) {
    throw new Error(
      '[OpenCode CLI] Bundled Node.js path is missing. ' +
        'Run "pnpm -F @accomplish/desktop download:nodejs" and rebuild before launching.',
    );
  }

  if (!fs.existsSync(bundledNode.nodePath)) {
    throw new Error(
      `[OpenCode CLI] Bundled Node.js executable not found at ${bundledNode.nodePath}. ` +
        'Run "pnpm -F @accomplish/desktop download:nodejs" and rebuild before launching.',
    );
  }

  try {
    fs.accessSync(bundledNode.nodePath, fs.constants.X_OK);
  } catch {
    throw new Error(
      `[OpenCode CLI] Bundled Node.js executable is not executable at ${bundledNode.nodePath}. ` +
        'Run "pnpm -F @accomplish/desktop download:nodejs" and rebuild before launching.',
    );
  }

  env.ELECTRON_RUN_AS_NODE = '1';
  logBundledNodeInfo();

  const delimiter = process.platform === 'win32' ? ';' : ':';
  const existingPath = env.PATH ?? env.Path ?? '';
  const combinedPath = existingPath
    ? `${bundledNode.binDir}${delimiter}${existingPath}`
    : bundledNode.binDir;
  env.PATH = combinedPath;
  if (process.platform === 'win32') {
    env.Path = combinedPath;
  }
  console.log('[OpenCode CLI] Added bundled Node.js to PATH:', bundledNode.binDir);

  if (process.platform === 'darwin') {
    env.PATH = getExtendedNodePath(env.PATH);
  }

  // Gather configuration for the reusable environment builder
  const apiKeys = await getAllApiKeys();
  const bedrockCredentials = getBedrockCredentials() as BedrockCredentials | null;

  // Determine OpenAI base URL
  const storage = getStorage();
  const configuredOpenAiBaseUrl = apiKeys.openai ? storage.getOpenAiBaseUrl().trim() : undefined;

  // Determine Ollama host
  const activeModel = storage.getActiveProviderModel();
  const selectedModel = storage.getSelectedModel();
  let ollamaHost: string | undefined;
  if (activeModel?.provider === 'ollama' && activeModel.baseUrl) {
    ollamaHost = activeModel.baseUrl;
  } else if (selectedModel?.provider === 'ollama' && selectedModel.baseUrl) {
    ollamaHost = selectedModel.baseUrl;
  }

  // Handle Vertex AI credentials
  let vertexCredentials: VertexCredentials | undefined;
  let vertexServiceAccountKeyPath: string | undefined;
  const vertexCredsJson = getApiKey('vertex');
  if (vertexCredsJson) {
    try {
      const parsed = JSON.parse(vertexCredsJson) as VertexCredentials;
      vertexCredentials = parsed;
      if (parsed.authType === 'serviceAccount' && parsed.serviceAccountJson) {
        const userDataPath = app.getPath('userData');
        vertexServiceAccountKeyPath = path.join(userDataPath, VERTEX_SA_KEY_FILENAME);
        fs.writeFileSync(vertexServiceAccountKeyPath, parsed.serviceAccountJson, { mode: 0o600 });
      }
    } catch {
      console.warn('[OpenCode CLI] Failed to parse Vertex credentials');
    }
  }

  // Build environment configuration
  const envConfig: EnvironmentConfig = {
    apiKeys,
    bedrockCredentials: bedrockCredentials || undefined,
    vertexCredentials,
    vertexServiceAccountKeyPath,
    bundledNodeBinPath: bundledNode.binDir,
    taskId: taskId || undefined,
    openAiBaseUrl: configuredOpenAiBaseUrl || undefined,
    ollamaHost,
  };

  // Use the core function to set API keys and credentials
  env = buildOpenCodeEnvironment(env, envConfig);

  if (taskId) {
    console.log('[OpenCode CLI] Task ID in environment:', taskId);
  }

  return env;
}

export async function buildCliArgs(config: TaskConfig, _taskId: string): Promise<string[]> {
  const storage = getStorage();
  const activeModel = storage.getActiveProviderModel();
  const selectedModel = activeModel || storage.getSelectedModel();

  return coreBuildCliArgs({
    prompt: config.prompt,
    sessionId: config.sessionId,
    selectedModel: selectedModel
      ? {
          provider: selectedModel.provider,
          model: selectedModel.model,
        }
      : null,
  });
}

export function getCliCommand(): { command: string; args: string[] } {
  return getOpenCodeCliPath();
}

export async function isCliAvailable(): Promise<boolean> {
  return isOpenCodeCliAvailable();
}

function toStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableValue(item));
  }
  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, innerValue]) => [key, toStableValue(innerValue)]);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

function computeDigest(value: unknown): string {
  const stableJson = JSON.stringify(toStableValue(value));
  return createHash('sha256').update(stableJson).digest('hex');
}

async function computeRuntimeDigests(
  azureFoundryToken: string | undefined,
): Promise<{ runtimeDigest: string; authDigest: string }> {
  const storage = getStorage();
  const apiKeys = await getAllApiKeys();
  const connectors = storage.getAllConnectors();
  const connectorTokens = connectors.map((connector) => ({
    id: connector.id,
    tokens: storage.getConnectorTokens(connector.id),
  }));

  const authDigest = computeDigest(apiKeys);
  const runtimeDigest = computeDigest({
    appSettings: storage.getAppSettings(),
    providerSettings: storage.getProviderSettings(),
    connectors,
    connectorTokens,
    apiKeys,
    azureFoundryToken: azureFoundryToken || null,
  });

  return {
    runtimeDigest,
    authDigest,
  };
}

async function prepareOpenCodeRuntime(): Promise<{ configChanged: boolean }> {
  if (openCodeRuntimeStateCache.inFlightPreparation) {
    return openCodeRuntimeStateCache.inFlightPreparation;
  }

  const preparationPromise = (async () => {
    let azureFoundryToken: string | undefined;
    const storage = getStorage();
    const activeModel = storage.getActiveProviderModel();
    const selectedModel = activeModel || storage.getSelectedModel();
    const azureFoundryConfig = storage.getAzureFoundryConfig();
    const azureFoundryProvider = storage.getConnectedProvider('azure-foundry');
    const azureFoundryCredentials = azureFoundryProvider?.credentials as
      | AzureFoundryCredentials
      | undefined;

    const isAzureFoundryEntraId =
      (selectedModel?.provider === 'azure-foundry' &&
        azureFoundryCredentials?.authMethod === 'entra-id') ||
      (selectedModel?.provider === 'azure-foundry' && azureFoundryConfig?.authType === 'entra-id');

    if (isAzureFoundryEntraId) {
      const tokenResult = await getAzureEntraToken();
      if (!tokenResult.success) {
        throw new Error(tokenResult.error);
      }
      azureFoundryToken = tokenResult.token;
    }

    const digests = await computeRuntimeDigests(azureFoundryToken);
    const authChanged = digests.authDigest !== openCodeRuntimeStateCache.authDigest;
    const configChanged = digests.runtimeDigest !== openCodeRuntimeStateCache.runtimeDigest;

    if (authChanged) {
      await syncApiKeysToOpenCodeAuth();
      openCodeRuntimeStateCache.authDigest = digests.authDigest;
    }

    if (!configChanged) {
      return { configChanged: false };
    }

    await generateOpenCodeConfig(azureFoundryToken);
    openCodeRuntimeStateCache.runtimeDigest = digests.runtimeDigest;
    return { configChanged: true };
  })();

  openCodeRuntimeStateCache.inFlightPreparation = preparationPromise;
  try {
    return await preparationPromise;
  } finally {
    if (openCodeRuntimeStateCache.inFlightPreparation === preparationPromise) {
      openCodeRuntimeStateCache.inFlightPreparation = null;
    }
  }
}

export async function onBeforeStart(): Promise<{ configChanged: boolean }> {
  return prepareOpenCodeRuntime();
}

function getBrowserServerConfig(): BrowserServerConfig {
  const bundledPaths = getBundledNodePaths();
  if (!bundledPaths) {
    throw new Error(
      '[Browser] Bundled Node.js path is missing. ' +
        'Run "pnpm -F @accomplish/desktop download:nodejs" and rebuild before launching.',
    );
  }
  return {
    mcpToolsPath: getMcpToolsPath(),
    bundledNodeBinPath: bundledPaths.binDir,
    devBrowserPort: DEV_BROWSER_PORT,
  };
}

export async function onBeforeTaskStart(
  callbacks: TaskCallbacks,
  isFirstTask: boolean,
): Promise<void> {
  if (isFirstTask) {
    callbacks.onProgress({ stage: 'browser', message: 'Preparing browser...', isFirstTask });
  }

  const browserConfig = getBrowserServerConfig();
  await ensureDevBrowserServer(browserConfig, callbacks.onProgress);
}

function parsePositiveEnvInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return fallback;
  }
  if (value === '1' || value.toLowerCase() === 'true') {
    return true;
  }
  if (value === '0' || value.toLowerCase() === 'false') {
    return false;
  }
  return fallback;
}

function assertPowerShellRuntimeAvailable(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return;
  }

  if (process.platform === 'win32') {
    const searchPath = process.env.PATH ?? process.env.Path ?? '';
    const resolved = findCommandInPath('powershell.exe', searchPath);
    if (!resolved) {
      throw new Error(
        '[OpenCode CLI] Required PowerShell executable "powershell.exe" was not found in PATH.',
      );
    }
    return;
  }

  const basePath = process.env.PATH ?? '';
  const searchPath = getExtendedNodePath(basePath);
  const resolved = findCommandInPath('pwsh', searchPath);
  if (!resolved) {
    throw new Error(
      '[OpenCode CLI] Required PowerShell executable "pwsh" was not found in PATH. Install PowerShell 7+ and relaunch the app.',
    );
  }
}

function getPowerShellPoolOptions() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return undefined;
  }

  return {
    minIdle: parsePositiveEnvInt('ACCOMPLISH_POWERSHELL_POOL_MIN_IDLE', 1),
    maxTotal: parsePositiveEnvInt('ACCOMPLISH_POWERSHELL_POOL_MAX_TOTAL', 11),
    coldStartFallback: parseBooleanEnv('ACCOMPLISH_POWERSHELL_POOL_COLD_START_FALLBACK', true),
  };
}

function getOpenCodeServerPoolOptions() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return undefined;
  }

  return {
    enabled: parseBooleanEnv('ACCOMPLISH_OPENCODE_SERVER_POOL_ENABLED', true),
    minIdle: parsePositiveEnvInt('ACCOMPLISH_OPENCODE_SERVER_POOL_MIN_IDLE', 1),
    maxTotal: parsePositiveEnvInt('ACCOMPLISH_OPENCODE_SERVER_POOL_MAX_TOTAL', 1),
    coldStartFallback: parseBooleanEnv('ACCOMPLISH_OPENCODE_SERVER_POOL_COLD_START_FALLBACK', true),
    startupTimeoutMs: parsePositiveEnvInt(
      'ACCOMPLISH_OPENCODE_SERVER_POOL_STARTUP_TIMEOUT_MS',
      60000,
    ),
  };
}

export function createElectronTaskManagerOptions(): TaskManagerOptions {
  assertPowerShellRuntimeAvailable();

  const powerShellPoolOptions = getPowerShellPoolOptions();
  const openCodeServerPoolOptions = getOpenCodeServerPoolOptions();

  return {
    adapterOptions: {
      platform: process.platform,
      isPackaged: app.isPackaged,
      tempPath: app.getPath('temp'),
      getCliCommand,
      buildEnvironment,
      onBeforeStart,
      getModelDisplayName,
      buildCliArgs,
      windowsPowerShellPool: process.platform === 'win32' ? powerShellPoolOptions : undefined,
      darwinPowerShellPool: process.platform === 'darwin' ? powerShellPoolOptions : undefined,
      windowsOpenCodeServerPool:
        process.platform === 'win32' ? openCodeServerPoolOptions : undefined,
      darwinOpenCodeServerPool:
        process.platform === 'darwin' ? openCodeServerPoolOptions : undefined,
    },
    defaultWorkingDirectory: app.getPath('temp'),
    maxConcurrentTasks: 10,
    isCliAvailable,
    onBeforeTaskStart,
  };
}
