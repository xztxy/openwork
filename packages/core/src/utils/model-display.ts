// Re-export from shared to maintain backwards compatibility
export { getModelDisplayName } from '@accomplish/shared';

// Additional utilities that depend on MODEL_DISPLAY_NAMES
import { MODEL_DISPLAY_NAMES, PROVIDER_PREFIXES } from '@accomplish/shared';

export function getKnownModelIds(): string[] {
  return Object.keys(MODEL_DISPLAY_NAMES);
}

export function isKnownModel(modelId: string): boolean {
  let cleanId = modelId;
  for (const prefix of PROVIDER_PREFIXES) {
    if (cleanId.startsWith(prefix)) {
      cleanId = cleanId.slice(prefix.length);
      break;
    }
  }
  if (cleanId.includes('/')) {
    cleanId = cleanId.split('/').pop() || cleanId;
  }
  cleanId = cleanId.replace(/-\d{8}$/, '');

  return cleanId in MODEL_DISPLAY_NAMES;
}
