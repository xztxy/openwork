import type { IpcMainInvokeEvent } from 'electron';
import { getApiKey } from '../../store/secureStorage';
import {
  validateElevenLabsApiKey,
  transcribeAudio,
  isElevenLabsConfigured,
} from '../../services/speechToText';
import { handle } from './utils';

export function registerSpeechHandlers(): void {
  handle('speech:is-configured', async (_event: IpcMainInvokeEvent) => {
    return isElevenLabsConfigured();
  });

  handle('speech:get-config', async (_event: IpcMainInvokeEvent) => {
    const apiKey = getApiKey('elevenlabs');
    return {
      enabled: Boolean(apiKey && apiKey.trim()),
      hasApiKey: Boolean(apiKey),
      apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : undefined,
    };
  });

  handle('speech:validate', async (_event: IpcMainInvokeEvent, apiKey?: string) => {
    return validateElevenLabsApiKey(apiKey);
  });

  handle(
    'speech:transcribe',
    async (_event: IpcMainInvokeEvent, audioData: ArrayBuffer, mimeType?: string) => {
      console.log('[IPC] speech:transcribe received:', {
        audioDataType: typeof audioData,
        audioDataByteLength: audioData?.byteLength,
        mimeType,
      });
      const buffer = Buffer.from(audioData);
      console.log('[IPC] Converted to buffer:', { bufferLength: buffer.length });
      return transcribeAudio(buffer, mimeType);
    },
  );
}
