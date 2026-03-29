import type {
  SelectedModel,
  OllamaConfig,
  LiteLLMConfig,
  AzureFoundryConfig,
  LMStudioConfig,
  HuggingFaceLocalConfig,
  NimConfig,
} from '../../common/types/provider.js';
import { getDatabase } from '../database.js';
import { safeParseJsonWithFallback } from '../../utils/json.js';

interface AppSettingsProviderRow {
  selected_model: string | null;
  ollama_config: string | null;
  litellm_config: string | null;
  azure_foundry_config: string | null;
  lmstudio_config: string | null;
  huggingface_local_config: string | null;
  openai_base_url: string | null;
  nim_config: string | null;
}

function getProviderRow(): AppSettingsProviderRow {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT selected_model, ollama_config, litellm_config, azure_foundry_config, lmstudio_config, huggingface_local_config, openai_base_url, nim_config FROM app_settings WHERE id = 1',
    )
    .get() as AppSettingsProviderRow;
}

export function getSelectedModel(): SelectedModel | null {
  return safeParseJsonWithFallback<SelectedModel>(getProviderRow().selected_model);
}

export function setSelectedModel(model: SelectedModel): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET selected_model = ? WHERE id = 1').run(JSON.stringify(model));
}

export function getOllamaConfig(): OllamaConfig | null {
  const row = getProviderRow();
  if (!row.ollama_config) return null;
  try {
    return JSON.parse(row.ollama_config) as OllamaConfig;
  } catch {
    return null;
  }
}

export function setOllamaConfig(config: OllamaConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET ollama_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getLiteLLMConfig(): LiteLLMConfig | null {
  const row = getProviderRow();
  if (!row.litellm_config) return null;
  try {
    return JSON.parse(row.litellm_config) as LiteLLMConfig;
  } catch {
    return null;
  }
}

export function setLiteLLMConfig(config: LiteLLMConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET litellm_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getAzureFoundryConfig(): AzureFoundryConfig | null {
  const row = getProviderRow();
  if (!row.azure_foundry_config) return null;
  try {
    return JSON.parse(row.azure_foundry_config) as AzureFoundryConfig;
  } catch {
    return null;
  }
}

export function setAzureFoundryConfig(config: AzureFoundryConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET azure_foundry_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getLMStudioConfig(): LMStudioConfig | null {
  const row = getProviderRow();
  if (!row.lmstudio_config) return null;
  try {
    return JSON.parse(row.lmstudio_config) as LMStudioConfig;
  } catch {
    return null;
  }
}

export function setLMStudioConfig(config: LMStudioConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET lmstudio_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getHuggingFaceLocalConfig(): HuggingFaceLocalConfig | null {
  const row = getProviderRow();
  if (!row.huggingface_local_config) return null;
  try {
    return JSON.parse(row.huggingface_local_config) as HuggingFaceLocalConfig;
  } catch {
    return null;
  }
}

export function setHuggingFaceLocalConfig(config: HuggingFaceLocalConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET huggingface_local_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getNimConfig(): NimConfig | null {
  const row = getProviderRow();
  if (!row.nim_config) return null;
  try {
    return JSON.parse(row.nim_config) as NimConfig;
  } catch {
    return null;
  }
}

export function setNimConfig(config: NimConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET nim_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getOpenAiBaseUrl(): string {
  const row = getProviderRow();
  return row.openai_base_url || '';
}

export function setOpenAiBaseUrl(baseUrl: string): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET openai_base_url = ? WHERE id = 1').run(baseUrl || '');
}
