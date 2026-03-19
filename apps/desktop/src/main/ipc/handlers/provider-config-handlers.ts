import type { IpcMainInvokeEvent } from 'electron';
import {
  testOllamaConnection,
  testLMStudioConnection,
  fetchLMStudioModels,
  validateLMStudioConfig,
  testLiteLLMConnection,
  fetchLiteLLMModels,
  testCustomConnection,
  testAzureFoundryConnection,
  validateHttpUrl,
  sanitizeString,
} from '@accomplish_ai/agent-core';
import type {
  OllamaConfig,
  AzureFoundryConfig,
  LiteLLMConfig,
  LMStudioConfig,
  SelectedModel,
  ProviderId,
  ConnectedProvider,
} from '@accomplish_ai/agent-core';
import { storeApiKey, getApiKey } from '../../store/secureStorage';
import { getStorage } from '../../store/storage';
import { cleanupVertexServiceAccountKey } from '../../opencode';
import { registerVertexHandlers } from '../../providers';
import { handle, API_KEY_VALIDATION_TIMEOUT_MS } from './utils';

export function registerProviderConfigHandlers(): void {
  const storage = getStorage();

  handle('model:get', async (_event: IpcMainInvokeEvent) => {
    return storage.getSelectedModel();
  });

  handle('model:set', async (_event: IpcMainInvokeEvent, model: SelectedModel) => {
    if (!model || typeof model.provider !== 'string' || typeof model.model !== 'string') {
      throw new Error('Invalid model configuration');
    }
    storage.setSelectedModel(model);
  });

  handle('ollama:test-connection', async (_event: IpcMainInvokeEvent, url: string) => {
    return testOllamaConnection(url);
  });

  handle('ollama:get-config', async (_event: IpcMainInvokeEvent) => {
    return storage.getOllamaConfig();
  });

  handle('ollama:set-config', async (_event: IpcMainInvokeEvent, config: OllamaConfig | null) => {
    if (config !== null) {
      if (typeof config.baseUrl !== 'string' || typeof config.enabled !== 'boolean') {
        throw new Error('Invalid Ollama configuration');
      }
      validateHttpUrl(config.baseUrl, 'Ollama base URL');
      if (config.lastValidated !== undefined && typeof config.lastValidated !== 'number') {
        throw new Error('Invalid Ollama configuration');
      }
      if (config.models !== undefined) {
        if (!Array.isArray(config.models)) {
          throw new Error('Invalid Ollama configuration: models must be an array');
        }
        for (const model of config.models) {
          if (
            typeof model.id !== 'string' ||
            typeof model.displayName !== 'string' ||
            typeof model.size !== 'number'
          ) {
            throw new Error('Invalid Ollama configuration: invalid model format');
          }
        }
      }
    }
    storage.setOllamaConfig(config);
  });

  handle('azure-foundry:get-config', async (_event: IpcMainInvokeEvent) => {
    return storage.getAzureFoundryConfig();
  });

  handle(
    'azure-foundry:set-config',
    async (_event: IpcMainInvokeEvent, config: AzureFoundryConfig | null) => {
      if (config !== null) {
        if (typeof config.baseUrl !== 'string' || !config.baseUrl.trim()) {
          throw new Error('Invalid Azure Foundry configuration: baseUrl is required');
        }
        if (typeof config.deploymentName !== 'string' || !config.deploymentName.trim()) {
          throw new Error('Invalid Azure Foundry configuration: deploymentName is required');
        }
        if (config.authType !== 'api-key' && config.authType !== 'entra-id') {
          throw new Error(
            'Invalid Azure Foundry configuration: authType must be api-key or entra-id',
          );
        }
        if (typeof config.enabled !== 'boolean') {
          throw new Error('Invalid Azure Foundry configuration: enabled must be a boolean');
        }
        try {
          validateHttpUrl(config.baseUrl, 'Azure Foundry base URL');
        } catch {
          throw new Error('Invalid Azure Foundry configuration: Invalid base URL format');
        }
      }
      storage.setAzureFoundryConfig(config);
    },
  );

  handle(
    'azure-foundry:test-connection',
    async (
      _event: IpcMainInvokeEvent,
      config: {
        endpoint: string;
        deploymentName: string;
        authType: 'api-key' | 'entra-id';
        apiKey?: string;
      },
    ) => {
      return testAzureFoundryConnection({
        endpoint: config.endpoint,
        deploymentName: config.deploymentName,
        authType: config.authType,
        apiKey: config.apiKey,
        timeout: API_KEY_VALIDATION_TIMEOUT_MS,
      });
    },
  );

  handle(
    'azure-foundry:save-config',
    async (
      _event: IpcMainInvokeEvent,
      config: {
        endpoint: string;
        deploymentName: string;
        authType: 'api-key' | 'entra-id';
        apiKey?: string;
      },
    ) => {
      const { endpoint, deploymentName, authType, apiKey } = config;

      if (authType === 'api-key' && apiKey) {
        storeApiKey('azure-foundry', apiKey);
      }

      const azureConfig: AzureFoundryConfig = {
        baseUrl: endpoint,
        deploymentName,
        authType,
        enabled: true,
        lastValidated: Date.now(),
      };
      storage.setAzureFoundryConfig(azureConfig);

      console.log('[Azure Foundry] Config saved for new provider settings:', {
        endpoint,
        deploymentName,
        authType,
        hasApiKey: !!apiKey,
      });
    },
  );

  handle(
    'litellm:test-connection',
    async (_event: IpcMainInvokeEvent, url: string, apiKey?: string) => {
      return testLiteLLMConnection(url, apiKey);
    },
  );

  handle('litellm:fetch-models', async (_event: IpcMainInvokeEvent) => {
    const config = storage.getLiteLLMConfig();
    const apiKey = getApiKey('litellm');
    return fetchLiteLLMModels({ config, apiKey: apiKey || undefined });
  });

  handle('litellm:get-config', async (_event: IpcMainInvokeEvent) => {
    return storage.getLiteLLMConfig();
  });

  handle('litellm:set-config', async (_event: IpcMainInvokeEvent, config: LiteLLMConfig | null) => {
    if (config !== null) {
      if (typeof config.baseUrl !== 'string' || typeof config.enabled !== 'boolean') {
        throw new Error('Invalid LiteLLM configuration');
      }
      validateHttpUrl(config.baseUrl, 'LiteLLM base URL');
      if (config.lastValidated !== undefined && typeof config.lastValidated !== 'number') {
        throw new Error('Invalid LiteLLM configuration');
      }
      if (config.models !== undefined) {
        if (!Array.isArray(config.models)) {
          throw new Error('Invalid LiteLLM configuration: models must be an array');
        }
        for (const model of config.models) {
          if (
            typeof model.id !== 'string' ||
            typeof model.name !== 'string' ||
            typeof model.provider !== 'string'
          ) {
            throw new Error('Invalid LiteLLM configuration: invalid model format');
          }
        }
      }
    }
    storage.setLiteLLMConfig(config);
  });

  handle(
    'custom:test-connection',
    async (_event: IpcMainInvokeEvent, baseUrl: string, apiKey?: string) => {
      try {
        const sanitizedUrl = sanitizeString(baseUrl, 'baseUrl', 256);
        const sanitizedApiKey = apiKey ? sanitizeString(apiKey, 'apiKey', 512) : undefined;
        return testCustomConnection(sanitizedUrl, sanitizedApiKey);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Connection test failed',
        };
      }
    },
  );

  handle('lmstudio:test-connection', async (_event: IpcMainInvokeEvent, url: string) => {
    return testLMStudioConnection({ url });
  });

  handle('lmstudio:fetch-models', async (_event: IpcMainInvokeEvent) => {
    const config = storage.getLMStudioConfig();
    if (!config || !config.baseUrl) {
      return { success: false, error: 'No LM Studio configured' };
    }
    return fetchLMStudioModels({ baseUrl: config.baseUrl });
  });

  handle('lmstudio:get-config', async (_event: IpcMainInvokeEvent) => {
    return storage.getLMStudioConfig();
  });

  handle(
    'lmstudio:set-config',
    async (_event: IpcMainInvokeEvent, config: LMStudioConfig | null) => {
      if (config !== null) {
        validateLMStudioConfig(config);
      }
      storage.setLMStudioConfig(config);
    },
  );

  handle('provider-settings:get', async () => {
    return storage.getProviderSettings();
  });

  handle(
    'provider-settings:set-active',
    async (_event: IpcMainInvokeEvent, providerId: ProviderId | null) => {
      storage.setActiveProvider(providerId);
    },
  );

  handle(
    'provider-settings:get-connected',
    async (_event: IpcMainInvokeEvent, providerId: ProviderId) => {
      return storage.getConnectedProvider(providerId);
    },
  );

  handle(
    'provider-settings:set-connected',
    async (_event: IpcMainInvokeEvent, providerId: ProviderId, provider: ConnectedProvider) => {
      storage.setConnectedProvider(providerId, provider);
    },
  );

  handle(
    'provider-settings:remove-connected',
    async (_event: IpcMainInvokeEvent, providerId: ProviderId) => {
      storage.removeConnectedProvider(providerId);
      if (providerId === 'vertex') {
        cleanupVertexServiceAccountKey();
      }
    },
  );

  handle(
    'provider-settings:update-model',
    async (_event: IpcMainInvokeEvent, providerId: ProviderId, modelId: string | null) => {
      storage.updateProviderModel(providerId, modelId);
    },
  );

  handle('provider-settings:set-debug', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    storage.setProviderDebugMode(enabled);
  });

  handle('provider-settings:get-debug', async () => {
    return storage.getProviderDebugMode();
  });

  // Vertex AI handlers
  registerVertexHandlers(handle);
}
