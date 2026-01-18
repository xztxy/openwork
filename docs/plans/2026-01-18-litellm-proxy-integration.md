# LiteLLM Proxy Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LiteLLM as a proxy platform option alongside OpenRouter, allowing users to connect to self-hosted LiteLLM proxies.

**Architecture:** LiteLLM is a self-hosted proxy requiring a user-provided URL (e.g., `http://localhost:4000`) and optional API key. The implementation mirrors the Ollama pattern: URL input, connection test, model discovery, and model selection. The OpenCode CLI config generator will include LiteLLM as an OpenAI-compatible provider.

**Tech Stack:** TypeScript, Electron IPC, React, electron-store, Playwright E2E

---

## Task 1: Add LiteLLM Types to Shared Package

**Files:**
- Modify: `packages/shared/src/types/provider.ts`

**Step 1: Add LiteLLMModel interface after OpenRouterConfig (line ~67)**

Add this after the `OpenRouterConfig` interface:

```typescript
/**
 * LiteLLM model info from API
 */
export interface LiteLLMModel {
  id: string;           // e.g., "openai/gpt-4"
  name: string;         // Display name (same as id for LiteLLM)
  provider: string;     // Extracted from model ID
  contextLength: number;
}

/**
 * LiteLLM configuration
 */
export interface LiteLLMConfig {
  baseUrl: string;      // e.g., "http://localhost:4000"
  enabled: boolean;
  lastValidated?: number;
  models?: LiteLLMModel[];
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add packages/shared/src/types/provider.ts
git commit -m "feat(types): add LiteLLM model and config types"
```

---

## Task 2: Add LiteLLM to API Key Provider Type

**Files:**
- Modify: `apps/desktop/src/main/store/secureStorage.ts:190`

**Step 1: Add 'litellm' to ApiKeyProvider type**

Change line 190 from:
```typescript
export type ApiKeyProvider = 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'custom' | 'bedrock';
```

To:
```typescript
export type ApiKeyProvider = 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'custom' | 'bedrock' | 'litellm';
```

**Step 2: Update getAllApiKeys function (lines 195-208)**

Change from:
```typescript
export async function getAllApiKeys(): Promise<Record<ApiKeyProvider, string | null>> {
  const [anthropic, openai, openrouter, google, xai, deepseek, zai, custom, bedrock] = await Promise.all([
    getApiKey('anthropic'),
    getApiKey('openai'),
    getApiKey('openrouter'),
    getApiKey('google'),
    getApiKey('xai'),
    getApiKey('deepseek'),
    getApiKey('zai'),
    getApiKey('custom'),
    getApiKey('bedrock'),
  ]);

  return { anthropic, openai, openrouter, google, xai, deepseek, zai, custom, bedrock };
}
```

To:
```typescript
export async function getAllApiKeys(): Promise<Record<ApiKeyProvider, string | null>> {
  const [anthropic, openai, openrouter, google, xai, deepseek, zai, custom, bedrock, litellm] = await Promise.all([
    getApiKey('anthropic'),
    getApiKey('openai'),
    getApiKey('openrouter'),
    getApiKey('google'),
    getApiKey('xai'),
    getApiKey('deepseek'),
    getApiKey('zai'),
    getApiKey('custom'),
    getApiKey('bedrock'),
    getApiKey('litellm'),
  ]);

  return { anthropic, openai, openrouter, google, xai, deepseek, zai, custom, bedrock, litellm };
}
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/main/store/secureStorage.ts
git commit -m "feat(storage): add litellm to API key providers"
```

---

## Task 3: Add LiteLLM Config to App Settings

**Files:**
- Modify: `apps/desktop/src/main/store/appSettings.ts`

**Step 1: Import LiteLLMConfig type (line 2)**

Change from:
```typescript
import type { SelectedModel, OllamaConfig } from '@accomplish/shared';
```

To:
```typescript
import type { SelectedModel, OllamaConfig, LiteLLMConfig } from '@accomplish/shared';
```

**Step 2: Add litellmConfig to AppSettingsSchema (after line 16)**

Change the interface from:
```typescript
interface AppSettingsSchema {
  /** Enable debug mode to show backend logs in UI */
  debugMode: boolean;
  /** Whether the user has completed the onboarding wizard */
  onboardingComplete: boolean;
  /** Selected AI model (provider/model format) */
  selectedModel: SelectedModel | null;
  /** Ollama server configuration */
  ollamaConfig: OllamaConfig | null;
}
```

To:
```typescript
interface AppSettingsSchema {
  /** Enable debug mode to show backend logs in UI */
  debugMode: boolean;
  /** Whether the user has completed the onboarding wizard */
  onboardingComplete: boolean;
  /** Selected AI model (provider/model format) */
  selectedModel: SelectedModel | null;
  /** Ollama server configuration */
  ollamaConfig: OllamaConfig | null;
  /** LiteLLM proxy configuration */
  litellmConfig: LiteLLMConfig | null;
}
```

**Step 3: Add litellmConfig default to store (after line 28)**

Change defaults from:
```typescript
const appSettingsStore = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: {
    debugMode: false,
    onboardingComplete: false,
    selectedModel: {
      provider: 'anthropic',
      model: 'anthropic/claude-opus-4-5',
    },
    ollamaConfig: null,
  },
});
```

To:
```typescript
const appSettingsStore = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: {
    debugMode: false,
    onboardingComplete: false,
    selectedModel: {
      provider: 'anthropic',
      model: 'anthropic/claude-opus-4-5',
    },
    ollamaConfig: null,
    litellmConfig: null,
  },
});
```

**Step 4: Add getter/setter functions (after setOllamaConfig, around line 85)**

Add after the `setOllamaConfig` function:

```typescript
/**
 * Get LiteLLM configuration
 */
export function getLiteLLMConfig(): LiteLLMConfig | null {
  return appSettingsStore.get('litellmConfig');
}

/**
 * Set LiteLLM configuration
 */
export function setLiteLLMConfig(config: LiteLLMConfig | null): void {
  appSettingsStore.set('litellmConfig', config);
}
```

**Step 5: Update getAppSettings return (around line 95)**

Change from:
```typescript
export function getAppSettings(): AppSettingsSchema {
  return {
    debugMode: appSettingsStore.get('debugMode'),
    onboardingComplete: appSettingsStore.get('onboardingComplete'),
    selectedModel: appSettingsStore.get('selectedModel'),
    ollamaConfig: appSettingsStore.get('ollamaConfig') ?? null,
  };
}
```

To:
```typescript
export function getAppSettings(): AppSettingsSchema {
  return {
    debugMode: appSettingsStore.get('debugMode'),
    onboardingComplete: appSettingsStore.get('onboardingComplete'),
    selectedModel: appSettingsStore.get('selectedModel'),
    ollamaConfig: appSettingsStore.get('ollamaConfig') ?? null,
    litellmConfig: appSettingsStore.get('litellmConfig') ?? null,
  };
}
```

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/main/store/appSettings.ts
git commit -m "feat(settings): add LiteLLM config storage"
```

---

## Task 4: Export LiteLLM Types from Shared Package

**Files:**
- Modify: `packages/shared/src/types/index.ts`

**Step 1: Check current exports and add LiteLLM types**

Read the file first to see current structure, then add exports for `LiteLLMModel` and `LiteLLMConfig` from `./provider`.

The file should export:
```typescript
export type { LiteLLMModel, LiteLLMConfig } from './provider';
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/shared/src/types/index.ts
git commit -m "feat(types): export LiteLLM types from shared package"
```

---

## Task 5: Add LiteLLM IPC Handlers

**Files:**
- Modify: `apps/desktop/src/main/ipc/handlers.ts`

**Step 1: Add 'litellm' to ALLOWED_API_KEY_PROVIDERS (line 82)**

Change from:
```typescript
const ALLOWED_API_KEY_PROVIDERS = new Set(['anthropic', 'openai', 'openrouter', 'google', 'xai', 'deepseek', 'zai', 'custom', 'bedrock']);
```

To:
```typescript
const ALLOWED_API_KEY_PROVIDERS = new Set(['anthropic', 'openai', 'openrouter', 'google', 'xai', 'deepseek', 'zai', 'custom', 'bedrock', 'litellm']);
```

**Step 2: Import getLiteLLMConfig and setLiteLLMConfig (line 42)**

Change from:
```typescript
import {
  getDebugMode,
  setDebugMode,
  getAppSettings,
  getOnboardingComplete,
  setOnboardingComplete,
  getSelectedModel,
  setSelectedModel,
  getOllamaConfig,
  setOllamaConfig,
} from '../store/appSettings';
```

To:
```typescript
import {
  getDebugMode,
  setDebugMode,
  getAppSettings,
  getOnboardingComplete,
  setOnboardingComplete,
  getSelectedModel,
  setSelectedModel,
  getOllamaConfig,
  setOllamaConfig,
  getLiteLLMConfig,
  setLiteLLMConfig,
} from '../store/appSettings';
```

**Step 3: Import LiteLLMConfig type (line 63)**

Change from:
```typescript
import type {
  TaskConfig,
  PermissionResponse,
  OpenCodeMessage,
  TaskMessage,
  TaskResult,
  TaskStatus,
  SelectedModel,
  OllamaConfig,
} from '@accomplish/shared';
```

To:
```typescript
import type {
  TaskConfig,
  PermissionResponse,
  OpenCodeMessage,
  TaskMessage,
  TaskResult,
  TaskStatus,
  SelectedModel,
  OllamaConfig,
  LiteLLMConfig,
} from '@accomplish/shared';
```

**Step 4: Add LiteLLM IPC handlers after OpenRouter handler (after line ~1223)**

Add these handlers after the `openrouter:fetch-models` handler:

```typescript
  // LiteLLM: Test connection and fetch models
  handle('litellm:test-connection', async (_event: IpcMainInvokeEvent, url: string, apiKey?: string) => {
    const sanitizedUrl = sanitizeString(url, 'litellmUrl', 256);
    const sanitizedApiKey = apiKey ? sanitizeString(apiKey, 'apiKey', 256) : undefined;

    // Validate URL format and protocol
    try {
      const parsed = new URL(sanitizedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, error: 'Only http and https URLs are allowed' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    try {
      const headers: Record<string, string> = {};
      if (sanitizedApiKey) {
        headers['Authorization'] = `Bearer ${sanitizedApiKey}`;
      }

      const response = await fetchWithTimeout(
        `${sanitizedUrl}/v1/models`,
        { method: 'GET', headers },
        API_KEY_VALIDATION_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = (errorData as { error?: { message?: string } })?.error?.message || `API returned status ${response.status}`;
        return { success: false, error: errorMessage };
      }

      const data = await response.json() as { data?: Array<{ id: string; object: string; created?: number; owned_by?: string }> };
      const models = (data.data || []).map((m) => {
        // Extract provider from model ID (e.g., "openai/gpt-4" -> "openai")
        const provider = m.id.split('/')[0] || m.owned_by || 'unknown';
        return {
          id: m.id,
          name: m.id, // LiteLLM uses id as name
          provider,
          contextLength: 0, // LiteLLM doesn't provide this in /v1/models
        };
      });

      console.log(`[LiteLLM] Connection successful, found ${models.length} models`);
      return { success: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      console.warn('[LiteLLM] Connection failed:', message);

      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Connection timed out. Make sure LiteLLM proxy is running.' };
      }
      return { success: false, error: `Cannot connect to LiteLLM: ${message}` };
    }
  });

  // LiteLLM: Fetch models from configured proxy
  handle('litellm:fetch-models', async (_event: IpcMainInvokeEvent) => {
    const config = getLiteLLMConfig();
    if (!config || !config.baseUrl) {
      return { success: false, error: 'No LiteLLM proxy configured' };
    }

    const apiKey = getApiKey('litellm');

    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetchWithTimeout(
        `${config.baseUrl}/v1/models`,
        { method: 'GET', headers },
        API_KEY_VALIDATION_TIMEOUT_MS
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = (errorData as { error?: { message?: string } })?.error?.message || `API returned status ${response.status}`;
        return { success: false, error: errorMessage };
      }

      const data = await response.json() as { data?: Array<{ id: string; object: string; created?: number; owned_by?: string }> };
      const models = (data.data || []).map((m) => {
        const provider = m.id.split('/')[0] || m.owned_by || 'unknown';
        return {
          id: m.id,
          name: m.id,
          provider,
          contextLength: 0,
        };
      });

      console.log(`[LiteLLM] Fetched ${models.length} models`);
      return { success: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch models';
      console.warn('[LiteLLM] Fetch failed:', message);

      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timed out. Check your LiteLLM proxy.' };
      }
      return { success: false, error: `Failed to fetch models: ${message}` };
    }
  });

  // LiteLLM: Get stored config
  handle('litellm:get-config', async (_event: IpcMainInvokeEvent) => {
    return getLiteLLMConfig();
  });

  // LiteLLM: Set config
  handle('litellm:set-config', async (_event: IpcMainInvokeEvent, config: LiteLLMConfig | null) => {
    if (config !== null) {
      if (typeof config.baseUrl !== 'string' || typeof config.enabled !== 'boolean') {
        throw new Error('Invalid LiteLLM configuration');
      }
      // Validate URL format and protocol
      try {
        const parsed = new URL(config.baseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('Only http and https URLs are allowed');
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('http')) {
          throw e; // Re-throw our protocol error
        }
        throw new Error('Invalid base URL format');
      }
      // Validate optional lastValidated if present
      if (config.lastValidated !== undefined && typeof config.lastValidated !== 'number') {
        throw new Error('Invalid LiteLLM configuration');
      }
      // Validate optional models array if present
      if (config.models !== undefined) {
        if (!Array.isArray(config.models)) {
          throw new Error('Invalid LiteLLM configuration: models must be an array');
        }
        for (const model of config.models) {
          if (typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.provider !== 'string') {
            throw new Error('Invalid LiteLLM configuration: invalid model format');
          }
        }
      }
    }
    setLiteLLMConfig(config);
    console.log('[LiteLLM] Config saved:', config);
  });
```

**Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc/handlers.ts
git commit -m "feat(ipc): add LiteLLM handlers for connection, models, and config"
```

---

## Task 6: Add LiteLLM to Preload API

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

**Step 1: Add 'litellm' to addApiKey provider type (line 45)**

Change from:
```typescript
  addApiKey: (
    provider: 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'custom' | 'bedrock',
    key: string,
    label?: string
  ): Promise<unknown> =>
```

To:
```typescript
  addApiKey: (
    provider: 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'custom' | 'bedrock' | 'litellm',
    key: string,
    label?: string
  ): Promise<unknown> =>
```

**Step 2: Add LiteLLM methods after OpenRouter fetchOpenRouterModels (after line ~118)**

Add after the `fetchOpenRouterModels` method:

```typescript
  // LiteLLM configuration
  testLiteLLMConnection: (url: string, apiKey?: string): Promise<{
    success: boolean;
    models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
    error?: string;
  }> => ipcRenderer.invoke('litellm:test-connection', url, apiKey),

  fetchLiteLLMModels: (): Promise<{
    success: boolean;
    models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
    error?: string;
  }> => ipcRenderer.invoke('litellm:fetch-models'),

  getLiteLLMConfig: (): Promise<{ baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; name: string; provider: string; contextLength: number }> } | null> =>
    ipcRenderer.invoke('litellm:get-config'),

  setLiteLLMConfig: (config: { baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; name: string; provider: string; contextLength: number }> } | null): Promise<void> =>
    ipcRenderer.invoke('litellm:set-config', config),
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/preload/index.ts
git commit -m "feat(preload): expose LiteLLM IPC methods to renderer"
```

---

## Task 7: Add LiteLLM to Renderer API

**Files:**
- Modify: `apps/desktop/src/renderer/lib/accomplish.ts`

**Step 1: Add 'litellm' to addApiKey provider type (line 47)**

Change from:
```typescript
  addApiKey(provider: 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'custom' | 'bedrock', key: string, label?: string): Promise<ApiKeyConfig>;
```

To:
```typescript
  addApiKey(provider: 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'custom' | 'bedrock' | 'litellm', key: string, label?: string): Promise<ApiKeyConfig>;
```

**Step 2: Add LiteLLM methods to interface (after OpenRouter fetchOpenRouterModels, around line 91)**

Add after the `fetchOpenRouterModels` method:

```typescript
  // LiteLLM configuration
  testLiteLLMConnection(url: string, apiKey?: string): Promise<{
    success: boolean;
    models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
    error?: string;
  }>;
  fetchLiteLLMModels(): Promise<{
    success: boolean;
    models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
    error?: string;
  }>;
  getLiteLLMConfig(): Promise<{ baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; name: string; provider: string; contextLength: number }> } | null>;
  setLiteLLMConfig(config: { baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; name: string; provider: string; contextLength: number }> } | null): Promise<void>;
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/renderer/lib/accomplish.ts
git commit -m "feat(renderer): add LiteLLM methods to accomplish API interface"
```

---

## Task 8: Add LiteLLM UI to Settings Dialog

**Files:**
- Modify: `apps/desktop/src/renderer/components/layout/SettingsDialog.tsx`

**Step 1: Add LiteLLM state variables (after OpenRouter state, around line 95)**

Add after the `savingOpenrouterApiKey` state:

```typescript
  // LiteLLM state
  const [litellmUrl, setLitellmUrl] = useState('http://localhost:4000');
  const [litellmApiKey, setLitellmApiKey] = useState('');
  const [litellmModels, setLitellmModels] = useState<Array<{ id: string; name: string; provider: string; contextLength: number }>>([]);
  const [litellmConnected, setLitellmConnected] = useState(false);
  const [litellmError, setLitellmError] = useState<string | null>(null);
  const [testingLitellm, setTestingLitellm] = useState(false);
  const [selectedLitellmModel, setSelectedLitellmModel] = useState<string>('');
  const [savingLitellm, setSavingLitellm] = useState(false);
  const [litellmSearch, setLitellmSearch] = useState('');
```

**Step 2: Add fetchLiteLLMConfig to useEffect (after fetchBedrockCredentials, around line 186)**

Add after `fetchBedrockCredentials();`:

```typescript
    const fetchLiteLLMConfig = async () => {
      try {
        const config = await accomplish.getLiteLLMConfig();
        if (config) {
          setLitellmUrl(config.baseUrl);
          // Auto-test connection if previously configured
          if (config.enabled) {
            const apiKey = (await accomplish.getAllApiKeys()).litellm;
            const result = await accomplish.testLiteLLMConnection(config.baseUrl, apiKey?.prefix);
            if (result.success && result.models) {
              setLitellmConnected(true);
              setLitellmModels(result.models);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch LiteLLM config:', err);
      }
    };
```

And add `fetchLiteLLMConfig();` to the list of fetches.

**Step 3: Add handleTestLiteLLM function (after handleSaveOpenRouterApiKey, around line 484)**

Add after the `handleSaveOpenRouterApiKey` function:

```typescript
  const handleTestLiteLLM = async () => {
    const accomplish = getAccomplish();
    setTestingLitellm(true);
    setLitellmError(null);
    setLitellmConnected(false);
    setLitellmModels([]);

    try {
      const apiKey = litellmApiKey.trim() || undefined;
      const result = await accomplish.testLiteLLMConnection(litellmUrl, apiKey);
      if (result.success && result.models) {
        setLitellmConnected(true);
        setLitellmModels(result.models);
        if (result.models.length > 0) {
          setSelectedLitellmModel(result.models[0].id);
        }
        // Save API key if provided
        if (apiKey) {
          await accomplish.addApiKey('litellm', apiKey);
        }
      } else {
        setLitellmError(result.error || 'Connection failed');
      }
    } catch (err) {
      setLitellmError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setTestingLitellm(false);
    }
  };

  const handleSaveLiteLLM = async () => {
    const accomplish = getAccomplish();
    setSavingLitellm(true);

    try {
      // Save the LiteLLM config
      await accomplish.setLiteLLMConfig({
        baseUrl: litellmUrl,
        enabled: true,
        lastValidated: Date.now(),
        models: litellmModels,
      });

      // Set as selected model
      await accomplish.setSelectedModel({
        provider: 'litellm',
        model: `litellm/${selectedLitellmModel}`,
        baseUrl: litellmUrl,
      });

      setSelectedModel({
        provider: 'litellm',
        model: `litellm/${selectedLitellmModel}`,
        baseUrl: litellmUrl,
      });

      const modelName = litellmModels.find(m => m.id === selectedLitellmModel)?.name || selectedLitellmModel;
      setModelStatusMessage(`Model updated to ${modelName}`);
    } catch (err) {
      setLitellmError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingLitellm(false);
    }
  };

  // Group LiteLLM models by provider (same pattern as OpenRouter)
  const groupedLitellmModels = litellmModels
    .filter(m =>
      litellmSearch === '' ||
      m.name.toLowerCase().includes(litellmSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(litellmSearch.toLowerCase())
    )
    .reduce((acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = [];
      }
      acc[model.provider].push(model);
      return acc;
    }, {} as Record<string, typeof litellmModels>);
```

**Step 4: Enable LiteLLM button and add UI (in the Proxy Platforms tab section, around line 729)**

Replace the disabled LiteLLM button:
```typescript
                    <button
                      disabled
                      className="flex-1 rounded-xl border p-4 text-center border-border opacity-50 cursor-not-allowed"
                    >
                      <div className="font-medium text-muted-foreground">LiteLLM</div>
                      <div className="text-xs text-muted-foreground mt-1">Coming soon</div>
                    </button>
```

With:
```typescript
                    <button
                      onClick={() => setSelectedProxyPlatform('litellm')}
                      className={`flex-1 rounded-xl border p-4 text-center transition-all duration-200 ${
                        selectedProxyPlatform === 'litellm'
                          ? 'border-primary bg-muted'
                          : 'border-border hover:border-ring'
                      }`}
                    >
                      <div className="font-medium text-foreground">LiteLLM</div>
                      <div className="text-xs text-muted-foreground mt-1">Self-hosted proxy</div>
                    </button>
```

**Step 5: Update selectedProxyPlatform type (around line 85)**

Change from:
```typescript
  const [selectedProxyPlatform, setSelectedProxyPlatform] = useState<'openrouter' | 'litellm'>('openrouter');
```

This is already correct, no change needed.

**Step 6: Add LiteLLM content section (after OpenRouter content, before the closing of activeTab === 'proxy')**

Add after the OpenRouter section closes (after `</>` around line 893):

```typescript
                  {selectedProxyPlatform === 'litellm' && (
                    <>
                      <p className="mb-4 text-sm text-muted-foreground leading-relaxed">
                        Connect to a self-hosted LiteLLM proxy to access multiple AI providers.
                      </p>

                      {/* LiteLLM URL Input */}
                      <div className="mb-4">
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          LiteLLM Proxy URL
                        </label>
                        <input
                          type="text"
                          value={litellmUrl}
                          onChange={(e) => {
                            setLitellmUrl(e.target.value);
                            setLitellmConnected(false);
                            setLitellmModels([]);
                          }}
                          placeholder="http://localhost:4000"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>

                      {/* LiteLLM API Key Input (Optional) */}
                      <div className="mb-4">
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          API Key <span className="text-muted-foreground">(Optional)</span>
                        </label>
                        <input
                          type="password"
                          value={litellmApiKey}
                          onChange={(e) => setLitellmApiKey(e.target.value)}
                          placeholder="Leave empty if not required"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>

                      {/* Test Connection Button */}
                      <button
                        onClick={handleTestLiteLLM}
                        disabled={testingLitellm}
                        className="w-full mb-4 rounded-md bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
                      >
                        {testingLitellm ? 'Testing...' : 'Test Connection'}
                      </button>

                      {/* Connection Status */}
                      {litellmConnected && (
                        <div className="mb-4 flex items-center gap-2 text-sm text-success">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Connected - {litellmModels.length} model{litellmModels.length !== 1 ? 's' : ''} available
                        </div>
                      )}

                      {litellmError && (
                        <div className="mb-4 flex items-center gap-2 text-sm text-destructive">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          {litellmError}
                        </div>
                      )}

                      {/* Model Selection (only show when connected) */}
                      {litellmConnected && litellmModels.length > 0 && (
                        <>
                          {/* Search */}
                          <div className="mb-4">
                            <input
                              type="text"
                              value={litellmSearch}
                              onChange={(e) => setLitellmSearch(e.target.value)}
                              placeholder="Search models..."
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                          </div>

                          {/* Grouped Model List */}
                          <div className="mb-4 max-h-64 overflow-y-auto rounded-md border border-input">
                            {Object.entries(groupedLitellmModels)
                              .sort(([a], [b]) => {
                                const priorityA = OPENROUTER_PROVIDER_PRIORITY.indexOf(a);
                                const priorityB = OPENROUTER_PROVIDER_PRIORITY.indexOf(b);
                                if (priorityA !== -1 && priorityB !== -1) return priorityA - priorityB;
                                if (priorityA !== -1) return -1;
                                if (priorityB !== -1) return 1;
                                return a.localeCompare(b);
                              })
                              .map(([provider, models]) => (
                                <div key={provider}>
                                  <div className="sticky top-0 bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">
                                    {provider}
                                  </div>
                                  {models.map((model) => (
                                    <label
                                      key={model.id}
                                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 ${
                                        selectedLitellmModel === model.id ? 'bg-muted' : ''
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        name="litellm-model"
                                        value={model.id}
                                        checked={selectedLitellmModel === model.id}
                                        onChange={(e) => setSelectedLitellmModel(e.target.value)}
                                        className="h-4 w-4"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-foreground truncate">
                                          {model.name}
                                        </div>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              ))}
                          </div>

                          {/* Save Button */}
                          <button
                            onClick={handleSaveLiteLLM}
                            disabled={savingLitellm || !selectedLitellmModel}
                            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {savingLitellm ? 'Saving...' : 'Use This Model'}
                          </button>
                        </>
                      )}

                      {/* Help text when not connected */}
                      {!litellmConnected && !litellmError && (
                        <p className="text-sm text-muted-foreground">
                          Make sure{' '}
                          <a
                            href="https://docs.litellm.ai/docs/proxy/quick_start"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            LiteLLM Proxy
                          </a>{' '}
                          is installed and running, then click Test Connection.
                        </p>
                      )}

                      {/* Current LiteLLM selection indicator */}
                      {selectedModel?.provider === 'litellm' && (
                        <div className="mt-4 rounded-lg bg-muted p-3">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">Currently using:</span>{' '}
                            {selectedModel.model.replace('litellm/', '')}
                          </p>
                        </div>
                      )}
                    </>
                  )}
```

**Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/layout/SettingsDialog.tsx
git commit -m "feat(ui): add LiteLLM platform UI in Settings dialog"
```

---

## Task 9: Add LiteLLM to Config Generator

**Files:**
- Modify: `apps/desktop/src/main/opencode/config-generator.ts`

**Step 1: Import getLiteLLMConfig (around line 5)**

Change from:
```typescript
import { getOllamaConfig } from '../store/appSettings';
```

To:
```typescript
import { getOllamaConfig, getLiteLLMConfig } from '../store/appSettings';
```

**Step 2: Add 'litellm' to baseProviders (around line 410)**

Change from:
```typescript
  const baseProviders = ['anthropic', 'openai', 'openrouter', 'google', 'xai', 'deepseek', 'zai-coding-plan', 'amazon-bedrock'];
```

To:
```typescript
  const baseProviders = ['anthropic', 'openai', 'openrouter', 'google', 'xai', 'deepseek', 'zai-coding-plan', 'amazon-bedrock', 'litellm'];
```

**Step 3: Add LiteLLMProviderModelConfig interface (after OpenRouterProviderConfig, around line 366)**

Add after `OpenRouterProviderConfig`:

```typescript
interface LiteLLMProviderModelConfig {
  name: string;
  tools?: boolean;
}

interface LiteLLMProviderConfig {
  npm: string;
  name: string;
  options: {
    baseURL: string;
  };
  models: Record<string, LiteLLMProviderModelConfig>;
}
```

**Step 4: Update ProviderConfig type (around line 368)**

Change from:
```typescript
type ProviderConfig = OllamaProviderConfig | BedrockProviderConfig | OpenRouterProviderConfig;
```

To:
```typescript
type ProviderConfig = OllamaProviderConfig | BedrockProviderConfig | OpenRouterProviderConfig | LiteLLMProviderConfig;
```

**Step 5: Add LiteLLM provider configuration (after OpenRouter config, around line 471)**

Add after the OpenRouter configuration block:

```typescript
  // Add LiteLLM provider configuration if enabled
  const litellmConfig = getLiteLLMConfig();
  const litellmApiKey = getApiKey('litellm');

  if (litellmConfig?.enabled && litellmConfig.models && litellmConfig.models.length > 0) {
    const litellmModels: Record<string, LiteLLMProviderModelConfig> = {};
    for (const model of litellmConfig.models) {
      litellmModels[model.id] = {
        name: model.name,
        tools: true,
      };
    }

    providerConfig.litellm = {
      npm: '@ai-sdk/openai-compatible',
      name: 'LiteLLM',
      options: {
        baseURL: `${litellmConfig.baseUrl}/v1`,
      },
      models: litellmModels,
    };

    console.log('[OpenCode Config] LiteLLM provider configured with models:', Object.keys(litellmModels));
  }
```

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/main/opencode/config-generator.ts
git commit -m "feat(config): add LiteLLM provider to OpenCode config generator"
```

---

## Task 10: Update Integration Test for secureStorage

**Files:**
- Modify: `apps/desktop/__tests__/integration/main/secureStorage.integration.test.ts`

**Step 1: Update getAllApiKeys empty store test (lines 240-250)**

Change from:
```typescript
      expect(result).toEqual({
        anthropic: null,
        openai: null,
        google: null,
        xai: null,
        deepseek: null,
        zai: null,
        openrouter: null,
        bedrock: null,
        custom: null,
      });
```

To:
```typescript
      expect(result).toEqual({
        anthropic: null,
        openai: null,
        google: null,
        xai: null,
        deepseek: null,
        zai: null,
        openrouter: null,
        bedrock: null,
        custom: null,
        litellm: null,
      });
```

**Step 2: Update clearSecureStorage test (lines 351-361)**

Change from:
```typescript
      expect(result).toEqual({
        anthropic: null,
        openai: null,
        google: null,
        xai: null,
        deepseek: null,
        zai: null,
        openrouter: null,
        bedrock: null,
        custom: null,
      });
```

To:
```typescript
      expect(result).toEqual({
        anthropic: null,
        openai: null,
        google: null,
        xai: null,
        deepseek: null,
        zai: null,
        openrouter: null,
        bedrock: null,
        custom: null,
        litellm: null,
      });
```

**Step 3: Run tests**

Run: `pnpm -F @accomplish/desktop test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add apps/desktop/__tests__/integration/main/secureStorage.integration.test.ts
git commit -m "test(storage): add litellm to getAllApiKeys test expectations"
```

---

## Task 11: Add E2E Page Object Methods for LiteLLM

**Files:**
- Modify: `apps/desktop/e2e/pages/settings.page.ts`

**Step 1: Update litellmPlatformButton getter (line 98)**

Change from:
```typescript
  get litellmPlatformButton() {
    return this.page.locator('button:has-text("LiteLLM")');
  }
```

To:
```typescript
  get litellmPlatformButton() {
    return this.page.locator('button:has-text("LiteLLM"):not([disabled])');
  }
```

**Step 2: Add LiteLLM-specific selectors (after litellmPlatformButton)**

Add after `litellmPlatformButton`:

```typescript
  get litellmUrlInput() {
    return this.page.getByPlaceholder('http://localhost:4000');
  }

  get litellmApiKeyInput() {
    return this.page.getByPlaceholder('Leave empty if not required');
  }

  get litellmTestConnectionButton() {
    return this.page.getByRole('button', { name: /Test Connection/ });
  }

  get litellmModelSearch() {
    return this.page.getByPlaceholder('Search models...');
  }

  get litellmUseModelButton() {
    return this.page.getByRole('button', { name: /Use This Model/ });
  }

  async selectLiteLLMPlatform() {
    await this.litellmPlatformButton.click();
  }
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/e2e/pages/settings.page.ts
git commit -m "test(e2e): add LiteLLM page object methods"
```

---

## Task 12: Add E2E Tests for LiteLLM

**Files:**
- Modify: `apps/desktop/e2e/specs/settings.spec.ts`

**Step 1: Add single E2E test first (after the last test, before closing describe)**

Add this test at the end of the Settings Dialog test suite:

```typescript
  test('should display LiteLLM as enabled option in Proxy Platforms tab', async ({ window }) => {
    const settingsPage = new SettingsPage(window);

    // Navigate to settings
    await window.waitForLoadState('domcontentloaded');
    await settingsPage.navigateToSettings();

    // Click Proxy Platforms tab
    await settingsPage.selectProxyPlatformsTab();

    // Verify LiteLLM platform button is visible and enabled
    await expect(settingsPage.litellmPlatformButton).toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });
    await expect(settingsPage.litellmPlatformButton).toBeEnabled();

    // Capture proxy platforms with LiteLLM enabled
    await captureForAI(
      window,
      'settings-dialog',
      'litellm-enabled',
      [
        'LiteLLM platform is visible and enabled',
        'Button can be clicked',
        'User can select LiteLLM as their proxy platform'
      ]
    );
  });
```

**Step 2: Run single E2E test to verify basic flow**

Run: `pnpm -F @accomplish/desktop test:e2e -- --grep "should display LiteLLM as enabled option"`
Expected: PASS

**Step 3: Add remaining E2E tests**

Add these tests after the first one:

```typescript
  test('should show URL and API key inputs when LiteLLM is selected', async ({ window }) => {
    const settingsPage = new SettingsPage(window);

    // Navigate to settings
    await window.waitForLoadState('domcontentloaded');
    await settingsPage.navigateToSettings();

    // Click Proxy Platforms tab
    await settingsPage.selectProxyPlatformsTab();

    // Click LiteLLM platform button
    await settingsPage.selectLiteLLMPlatform();

    // Verify URL input is visible
    await expect(settingsPage.litellmUrlInput).toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });

    // Verify API key input is visible (optional field)
    await expect(settingsPage.litellmApiKeyInput).toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });

    // Verify Test Connection button is visible
    await expect(settingsPage.litellmTestConnectionButton).toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });

    // Capture LiteLLM selection state
    await captureForAI(
      window,
      'settings-dialog',
      'litellm-selected',
      [
        'LiteLLM platform is selected',
        'URL input is visible with default value',
        'Optional API key input is visible',
        'Test Connection button is visible'
      ]
    );
  });

  test('should allow editing LiteLLM URL', async ({ window }) => {
    const settingsPage = new SettingsPage(window);

    // Navigate to settings
    await window.waitForLoadState('domcontentloaded');
    await settingsPage.navigateToSettings();

    // Click Proxy Platforms tab
    await settingsPage.selectProxyPlatformsTab();

    // Click LiteLLM platform button
    await settingsPage.selectLiteLLMPlatform();

    // Clear and enter a custom URL
    await settingsPage.litellmUrlInput.clear();
    await settingsPage.litellmUrlInput.fill('http://192.168.1.100:8000');

    // Verify value was entered
    await expect(settingsPage.litellmUrlInput).toHaveValue('http://192.168.1.100:8000');

    // Capture edited URL state
    await captureForAI(
      window,
      'settings-dialog',
      'litellm-url-edited',
      [
        'LiteLLM URL input accepts custom values',
        'User can connect to remote LiteLLM instances',
        'URL field is editable'
      ]
    );
  });
```

**Step 4: Run full E2E test suite**

Run: `pnpm -F @accomplish/desktop test:e2e`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add apps/desktop/e2e/specs/settings.spec.ts
git commit -m "test(e2e): add LiteLLM E2E tests for Proxy Platforms tab"
```

---

## Task 13: Run Full CI Validation

**Step 1: Run lint**

Run: `pnpm lint`
Expected: No errors

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Run integration tests**

Run: `pnpm -F @accomplish/desktop test`
Expected: All tests PASS

**Step 4: Run E2E tests**

Run: `pnpm -F @accomplish/desktop test:e2e`
Expected: All tests PASS (18+ tests)

**Step 5: Create summary commit**

```bash
git add -A
git commit -m "feat: add LiteLLM proxy platform integration

- Add LiteLLMModel and LiteLLMConfig types
- Add litellm to API key providers
- Add LiteLLM config storage in app settings
- Add IPC handlers for LiteLLM connection and models
- Add LiteLLM to preload and renderer API
- Enable LiteLLM in Settings > Proxy Platforms UI
- Add LiteLLM to OpenCode config generator
- Update integration tests for litellm provider
- Add E2E tests for LiteLLM platform

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary of Files Modified

| File | Change |
|------|--------|
| `packages/shared/src/types/provider.ts` | Add `LiteLLMModel`, `LiteLLMConfig` types |
| `packages/shared/src/types/index.ts` | Export LiteLLM types |
| `apps/desktop/src/main/store/secureStorage.ts` | Add `'litellm'` to `ApiKeyProvider` |
| `apps/desktop/src/main/store/appSettings.ts` | Add `litellmConfig` storage |
| `apps/desktop/src/main/ipc/handlers.ts` | Add LiteLLM IPC handlers |
| `apps/desktop/src/preload/index.ts` | Expose LiteLLM methods |
| `apps/desktop/src/renderer/lib/accomplish.ts` | Add LiteLLM to API interface |
| `apps/desktop/src/renderer/components/layout/SettingsDialog.tsx` | Add LiteLLM UI |
| `apps/desktop/src/main/opencode/config-generator.ts` | Add LiteLLM provider config |
| `apps/desktop/__tests__/integration/main/secureStorage.integration.test.ts` | Update test expectations |
| `apps/desktop/e2e/pages/settings.page.ts` | Add LiteLLM page object methods |
| `apps/desktop/e2e/specs/settings.spec.ts` | Add LiteLLM E2E tests |
