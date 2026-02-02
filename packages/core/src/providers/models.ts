/**
 * Model configuration utilities
 *
 * Provides functions to work with provider models and their configurations.
 */

import {
  DEFAULT_PROVIDERS,
  DEFAULT_MODEL,
  type ProviderType,
  type ModelConfig,
} from '@accomplish/shared';

// Re-export constants from shared
export { DEFAULT_PROVIDERS, DEFAULT_MODEL };

/**
 * Get all available models for a given provider
 *
 * @param provider - The provider type
 * @returns Array of model configurations for the provider
 */
export function getModelsForProvider(provider: ProviderType): ModelConfig[] {
  const providerConfig = DEFAULT_PROVIDERS.find((p) => p.id === provider);
  return providerConfig?.models ?? [];
}

/**
 * Get the default/recommended model for a given provider
 *
 * @param provider - The provider type
 * @returns The default model configuration, or undefined if provider has no models
 */
export function getDefaultModelForProvider(provider: ProviderType): ModelConfig | undefined {
  const models = getModelsForProvider(provider);
  return models[0];
}

/**
 * Check if a model ID is valid for a given provider
 *
 * @param provider - The provider type
 * @param modelId - The model ID to validate (can be short ID or full ID)
 * @returns True if the model exists for the provider
 */
export function isValidModel(provider: ProviderType, modelId: string): boolean {
  const models = getModelsForProvider(provider);
  return models.some((m) => m.id === modelId || m.fullId === modelId);
}

/**
 * Find a model by its ID (short or full) across all providers
 *
 * @param modelId - The model ID to find
 * @returns The model configuration, or undefined if not found
 */
export function findModelById(modelId: string): ModelConfig | undefined {
  for (const provider of DEFAULT_PROVIDERS) {
    const model = provider.models.find((m) => m.id === modelId || m.fullId === modelId);
    if (model) {
      return model;
    }
  }
  return undefined;
}

/**
 * Get the provider configuration by ID
 *
 * @param providerId - The provider type
 * @returns The provider configuration, or undefined if not found
 */
export function getProviderById(providerId: ProviderType) {
  return DEFAULT_PROVIDERS.find((p) => p.id === providerId);
}

/**
 * Check if a provider requires an API key
 *
 * @param provider - The provider type
 * @returns True if the provider requires an API key
 */
export function providerRequiresApiKey(provider: ProviderType): boolean {
  const providerConfig = getProviderById(provider);
  return providerConfig?.requiresApiKey ?? false;
}

/**
 * Get the environment variable name for a provider's API key
 *
 * @param provider - The provider type
 * @returns The environment variable name, or undefined if not applicable
 */
export function getApiKeyEnvVar(provider: ProviderType): string | undefined {
  const providerConfig = getProviderById(provider);
  return providerConfig?.apiKeyEnvVar;
}
