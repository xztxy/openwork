import Store from 'electron-store';
import type { SelectedModel, OllamaConfig, AzureFoundryConfig, LiteLLMConfig } from '@accomplish/shared';

/**
 * App settings schema
 */
interface AppSettingsSchema {
  /** Enable debug mode to show backend logs in UI */
  debugMode: boolean;
  /** Whether the user has completed the onboarding wizard */
  onboardingComplete: boolean;
  /** Selected AI model (provider/model format) */
  selectedModel: SelectedModel | null;
  /** Ollama server configuration */
  ollamaConfig: OllamaConfig | null;
  /** Azure Foundry configuration */
  azureFoundryConfig: AzureFoundryConfig | null;
  /** LiteLLM proxy configuration */
  litellmConfig: LiteLLMConfig | null;
}

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
    azureFoundryConfig: null,
    litellmConfig: null,
  },
});

/**
 * Get debug mode setting
 */
export function getDebugMode(): boolean {
  return appSettingsStore.get('debugMode');
}

/**
 * Set debug mode setting
 */
export function setDebugMode(enabled: boolean): void {
  appSettingsStore.set('debugMode', enabled);
}

/**
 * Get onboarding complete setting
 */
export function getOnboardingComplete(): boolean {
  return appSettingsStore.get('onboardingComplete');
}

/**
 * Set onboarding complete setting
 */
export function setOnboardingComplete(complete: boolean): void {
  appSettingsStore.set('onboardingComplete', complete);
}

/**
 * Get selected model
 */
export function getSelectedModel(): SelectedModel | null {
  return appSettingsStore.get('selectedModel');
}

/**
 * Set selected model
 */
export function setSelectedModel(model: SelectedModel): void {
  appSettingsStore.set('selectedModel', model);
}

/**
 * Get Ollama configuration
 */
export function getOllamaConfig(): OllamaConfig | null {
  return appSettingsStore.get('ollamaConfig');
}

/**
 * Set Ollama configuration
 */
export function setOllamaConfig(config: OllamaConfig | null): void {
  appSettingsStore.set('ollamaConfig', config);
}

/**
 * Get Azure Foundry configuration
 */
export function getAzureFoundryConfig(): AzureFoundryConfig | null {
  return appSettingsStore.get('azureFoundryConfig');
}

/**
 * Set Azure Foundry configuration
 */
export function setAzureFoundryConfig(config: AzureFoundryConfig | null): void {
  appSettingsStore.set('azureFoundryConfig', config);
}

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

/**
 * Get all app settings
 */
export function getAppSettings(): AppSettingsSchema {
  return {
    debugMode: appSettingsStore.get('debugMode'),
    onboardingComplete: appSettingsStore.get('onboardingComplete'),
    selectedModel: appSettingsStore.get('selectedModel'),
    ollamaConfig: appSettingsStore.get('ollamaConfig') ?? null,
    azureFoundryConfig: appSettingsStore.get('azureFoundryConfig') ?? null,
    litellmConfig: appSettingsStore.get('litellmConfig') ?? null,
  };
}

/**
 * Clear all app settings (reset to defaults)
 * Used during fresh install cleanup
 */
export function clearAppSettings(): void {
  appSettingsStore.clear();
}
