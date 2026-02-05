import {
  createSpeechService,
  type SpeechServiceAPI,
  type TranscriptionResult,
  type TranscriptionError,
} from '@accomplish_ai/agent-core';
import { getStorage } from '../store/secureStorage';

export type { TranscriptionResult, TranscriptionError };

let _speechService: SpeechServiceAPI | null = null;

function getSpeechService(): SpeechServiceAPI {
  if (!_speechService) {
    _speechService = createSpeechService({ storage: getStorage() });
  }
  return _speechService;
}

export function getElevenLabsApiKey(): string | null {
  return getSpeechService().getElevenLabsApiKey();
}

export function isElevenLabsConfigured(): boolean {
  return getSpeechService().isElevenLabsConfigured();
}

export async function validateElevenLabsApiKey(
  apiKey?: string
): Promise<{ valid: boolean; error?: string }> {
  return getSpeechService().validateElevenLabsApiKey(apiKey);
}

export async function transcribeAudio(
  audioData: Buffer,
  mimeType: string = 'audio/webm'
): Promise<
  | { success: true; result: TranscriptionResult }
  | { success: false; error: TranscriptionError }
> {
  return getSpeechService().transcribeAudio(audioData, mimeType);
}
