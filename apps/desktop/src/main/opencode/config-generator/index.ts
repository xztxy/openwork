/**
 * Config Generator Module
 *
 * Modular OpenCode configuration generator with separated concerns:
 * - types.ts: Type definitions
 * - paths.ts: Path resolution utilities
 * - system-prompt.ts: System prompt template and utilities
 * - generator.ts: Main orchestrator
 *
 * @module config-generator
 */

// Re-export everything from the generator module (main entry point)
export {
  generateOpenCodeConfig,
  assembleConfig,
  getOpenCodeConfigPath,
  type AssembleConfigOptions,
} from './generator';

// Re-export types
export type {
  OpenCodeConfig,
  AgentConfig,
  McpServerConfig,
  ProviderConfig,
  ProviderModelConfig,
  OllamaProviderConfig,
  BedrockProviderConfig,
  AzureFoundryProviderConfig,
  OpenRouterProviderConfig,
  MoonshotProviderConfig,
  LiteLLMProviderConfig,
  ZaiProviderConfig,
  LMStudioProviderConfig,
} from './types';

// Re-export path utilities
export {
  getMcpToolsPath,
  getOpenCodeConfigDir,
  resolveBundledTsxCommand,
  resolveMcpCommand,
} from './paths';

// Re-export system prompt utilities
export {
  ACCOMPLISH_AGENT_NAME,
  ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE,
  getPlatformEnvironmentInstructions,
} from './system-prompt';
