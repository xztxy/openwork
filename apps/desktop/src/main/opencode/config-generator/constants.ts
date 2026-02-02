/**
 * Constants for OpenCode configuration generation
 *
 * This module contains all constant values used throughout the config-generator:
 * - Agent name
 * - NPM package mappings for openai-compatible providers
 * - Provider URLs
 * - MCP server defaults
 * - Z.AI model definitions
 * - Provider ID mappings
 * - Base enabled providers list
 *
 * @module config-generator/constants
 */

import type { ProviderId } from '@accomplish/shared';
import type { ZaiProviderModelConfig } from './types';

/**
 * Agent name used by Accomplish
 */
export const ACCOMPLISH_AGENT_NAME = 'accomplish';

/**
 * NPM packages for openai-compatible providers
 * All these providers use the @ai-sdk/openai-compatible package
 */
export const NPM_PACKAGES = {
  ollama: '@ai-sdk/openai-compatible',
  openrouter: '@ai-sdk/openai-compatible',
  moonshot: '@ai-sdk/openai-compatible',
  litellm: '@ai-sdk/openai-compatible',
  zai: '@ai-sdk/openai-compatible',
  lmstudio: '@ai-sdk/openai-compatible',
  'azure-foundry': '@ai-sdk/openai-compatible',
} as const;

/**
 * Provider API URLs
 */
export const PROVIDER_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  zai: {
    china: 'https://open.bigmodel.cn/api/paas/v4',
    international: 'https://api.z.ai/api/coding/paas/v4',
  },
} as const;

/**
 * Default MCP server configuration
 */
export const MCP_CONFIG = {
  type: 'local',
  enabled: true,
  timeout: 30000,
} as const;

/**
 * Z.AI Coding Plan model definitions
 * All models support tool calling
 */
export const ZAI_MODELS: Record<string, ZaiProviderModelConfig> = {
  'glm-4.7-flashx': { name: 'GLM-4.7 FlashX (Latest)', tools: true },
  'glm-4.7': { name: 'GLM-4.7', tools: true },
  'glm-4.7-flash': { name: 'GLM-4.7 Flash', tools: true },
  'glm-4.6': { name: 'GLM-4.6', tools: true },
  'glm-4.5-flash': { name: 'GLM-4.5 Flash', tools: true },
};

/**
 * MCP servers used by Accomplish
 */
export const MCP_SERVERS = [
  'file-permission',
  'ask-user-question',
  'dev-browser-mcp',
  'complete-task',
  'start-task',
] as const;

/**
 * Provider ID to OpenCode CLI provider name mapping
 * Maps our internal provider IDs to the names used by OpenCode CLI
 */
export const PROVIDER_ID_TO_OPENCODE: Record<ProviderId, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  xai: 'xai',
  deepseek: 'deepseek',
  moonshot: 'moonshot',
  zai: 'zai-coding-plan',
  bedrock: 'amazon-bedrock',
  'azure-foundry': 'azure-foundry',
  ollama: 'ollama',
  openrouter: 'openrouter',
  litellm: 'litellm',
  minimax: 'minimax',
  lmstudio: 'lmstudio',
};

/**
 * Base providers that are always enabled
 * Does not include local providers (ollama, lmstudio, litellm)
 * which require explicit configuration
 */
export const BASE_ENABLED_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'xai',
  'deepseek',
  'moonshot',
  'zai-coding-plan',
  'amazon-bedrock',
  'minimax',
] as const;
