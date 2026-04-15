import fs from 'fs';
import path from 'path';

import type { SelectedModel } from '../common/types/provider.js';
import { PROVIDER_ID_TO_OPENCODE } from '../common/types/providerSettings.js';

export interface SdkSelectedModelRef {
  providerID: string;
  modelID: string;
}

interface RuntimeModelResolutionOptions {
  userDataPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fileExists?: (filePath: string) => boolean;
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function stripModelPrefix(model: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

function getLastModelSegment(model: string): string {
  const segments = model.split('/');
  return segments[segments.length - 1] ?? model;
}

function getOpencodeProviderId(provider: SelectedModel['provider']): string {
  if (provider in PROVIDER_ID_TO_OPENCODE) {
    return PROVIDER_ID_TO_OPENCODE[provider as keyof typeof PROVIDER_ID_TO_OPENCODE];
  }
  return provider;
}

export function resolveLlamaCppRuntimeModelName(
  modelId: string,
  options: RuntimeModelResolutionOptions = {},
): string {
  const effectivePlatform = options.platform ?? process.platform;
  const effectiveArch = options.arch ?? process.arch;
  if (effectivePlatform !== 'darwin' || effectiveArch !== 'arm64') {
    return modelId;
  }

  const effectiveUserDataPath = options.userDataPath?.trim() || process.env.XDG_DATA_HOME?.trim();
  if (!effectiveUserDataPath) {
    return modelId;
  }

  const fileExists = options.fileExists ?? fs.existsSync;
  const modelDir = path.join(
    effectiveUserDataPath,
    'llama-cpp-models',
    sanitizeForFilename(modelId),
  );
  const mlxManifestPath = path.join(modelDir, '.accomplish-mlx-manifest.json');
  if (!fileExists(mlxManifestPath)) {
    return modelId;
  }

  return modelDir;
}

export function normalizeSelectedModelForSdk(
  selectedModel: SelectedModel | null,
  // Kept for API parity with commercial 1a320029 — the `local-model` branch
  // (which consumed these options via `resolveLlamaCppRuntimeModelName`) is
  // commercial-only and excluded from OSS. If/when OSS adds `local-model`
  // provider support, re-use the parameter instead of renaming it back.
  _options: RuntimeModelResolutionOptions = {},
): SdkSelectedModelRef | null {
  if (!selectedModel) {
    return null;
  }

  if (selectedModel.provider === 'zai') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.zai,
      modelID: getLastModelSegment(selectedModel.model),
    };
  }

  if (selectedModel.provider === 'deepseek') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.deepseek,
      modelID: getLastModelSegment(selectedModel.model),
    };
  }

  if (selectedModel.provider === 'openrouter') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.openrouter,
      modelID: stripModelPrefix(selectedModel.model, ['openrouter/']),
    };
  }

  if (selectedModel.provider === 'ollama') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.ollama,
      modelID: stripModelPrefix(selectedModel.model, ['ollama/']),
    };
  }

  if (selectedModel.provider === 'litellm') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.litellm,
      modelID: stripModelPrefix(selectedModel.model, ['litellm/']),
    };
  }

  if (selectedModel.provider === 'lmstudio') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.lmstudio,
      modelID: stripModelPrefix(selectedModel.model, ['lmstudio/']),
    };
  }

  // Note: commercial 1a320029 branches for 'local-model' and 'auto-model-routing'
  // providers are OSS-divergent — those providers do not exist in OSS's
  // `ProviderId` union. If/when OSS adds them, reintroduce the branches from
  // the commercial snapshot verbatim.

  if (selectedModel.provider === 'vertex') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.vertex,
      modelID: selectedModel.model.replace(/^vertex\/[^/]+\//, ''),
    };
  }

  if (selectedModel.provider === 'bedrock') {
    return {
      providerID: PROVIDER_ID_TO_OPENCODE.bedrock,
      modelID: stripModelPrefix(selectedModel.model, ['amazon-bedrock/', 'bedrock/']),
    };
  }

  return {
    providerID: getOpencodeProviderId(selectedModel.provider),
    modelID: stripModelPrefix(selectedModel.model, [`${selectedModel.provider}/`]),
  };
}
