import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'net';
import {
  transformRequestBody,
  ensureAzureFoundryProxy,
  stopAzureFoundryProxy,
  isAzureFoundryProxyRunning,
} from '../../../../src/opencode/proxies/azure-foundry-proxy.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine free port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

describe('Azure Foundry Proxy', () => {
  let proxyPort = 0;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    proxyPort = await getFreePort();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Clean up any running proxy
    await stopAzureFoundryProxy();
  });

  describe('transformRequestBody', () => {
    it('should strip reasoning_effort parameter', () => {
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          reasoning_effort: 'high',
        }),
      );

      const result = transformRequestBody(body);
      const parsed = JSON.parse(result.toString());

      expect(parsed.reasoning_effort).toBeUndefined();
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.messages).toBeDefined();
    });

    it('should convert max_tokens to max_completion_tokens', () => {
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1000,
        }),
      );

      const result = transformRequestBody(body);
      const parsed = JSON.parse(result.toString());

      expect(parsed.max_tokens).toBeUndefined();
      expect(parsed.max_completion_tokens).toBe(1000);
    });

    it('should not overwrite existing max_completion_tokens', () => {
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1000,
          max_completion_tokens: 500,
        }),
      );

      const result = transformRequestBody(body);
      const parsed = JSON.parse(result.toString());

      expect(parsed.max_tokens).toBeUndefined();
      expect(parsed.max_completion_tokens).toBe(500);
    });

    it('should return unmodified body if no transformations needed', () => {
      const original = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const body = Buffer.from(JSON.stringify(original));

      const result = transformRequestBody(body);
      const parsed = JSON.parse(result.toString());

      expect(parsed).toEqual(original);
    });

    it('should return original buffer for invalid JSON', () => {
      const body = Buffer.from('not valid json');

      const result = transformRequestBody(body);

      expect(result.toString()).toBe('not valid json');
    });

    it('should handle both transformations together', () => {
      const body = Buffer.from(
        JSON.stringify({
          model: 'o1',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 2000,
          reasoning_effort: 'medium',
        }),
      );

      const result = transformRequestBody(body);
      const parsed = JSON.parse(result.toString());

      expect(parsed.reasoning_effort).toBeUndefined();
      expect(parsed.max_tokens).toBeUndefined();
      expect(parsed.max_completion_tokens).toBe(2000);
    });

    it('should handle empty buffer', () => {
      const body = Buffer.from('');

      const result = transformRequestBody(body);

      expect(result.toString()).toBe('');
    });
  });

  describe('ensureAzureFoundryProxy', () => {
    it('should start proxy server and return proxy info', async () => {
      const result = await ensureAzureFoundryProxy('https://api.azure.com/openai', {
        port: proxyPort,
      });

      expect(result.baseURL).toBe(`http://127.0.0.1:${proxyPort}`);
      expect(result.targetBaseURL).toBe('https://api.azure.com/openai');
      expect(result.port).toBe(proxyPort);
    });

    it('should reuse existing proxy server', async () => {
      const result1 = await ensureAzureFoundryProxy('https://api.azure.com/openai', {
        port: proxyPort,
      });
      const result2 = await ensureAzureFoundryProxy('https://api.azure.com/openai2', {
        port: proxyPort,
      });

      // Both should return same proxy URL
      expect(result1.baseURL).toBe(result2.baseURL);
      // But target should be updated
      expect(result2.targetBaseURL).toBe('https://api.azure.com/openai2');
    });

    it('should normalize URL by removing trailing slash', async () => {
      const result = await ensureAzureFoundryProxy('https://api.azure.com/openai/', {
        port: proxyPort,
      });

      expect(result.targetBaseURL).toBe('https://api.azure.com/openai');
    });

    it('should throw for invalid URL', async () => {
      await expect(ensureAzureFoundryProxy('not-a-url')).rejects.toThrow('Invalid URL format');
    });

    it('should throw for unsupported protocol', async () => {
      await expect(ensureAzureFoundryProxy('ftp://api.azure.com')).rejects.toThrow(
        'Invalid protocol: ftp:',
      );
    });
  });

  describe('stopAzureFoundryProxy', () => {
    it('should stop running proxy', async () => {
      await ensureAzureFoundryProxy('https://api.azure.com/openai', { port: proxyPort });
      expect(isAzureFoundryProxyRunning()).toBe(true);

      await stopAzureFoundryProxy();

      expect(isAzureFoundryProxyRunning()).toBe(false);
    });

    it('should not throw when proxy not running', async () => {
      await stopAzureFoundryProxy(); // Should not throw

      expect(isAzureFoundryProxyRunning()).toBe(false);
    });
  });

  describe('isAzureFoundryProxyRunning', () => {
    it('should return false initially', () => {
      expect(isAzureFoundryProxyRunning()).toBe(false);
    });

    it('should return true after starting proxy', async () => {
      await ensureAzureFoundryProxy('https://api.azure.com/openai', { port: proxyPort });

      expect(isAzureFoundryProxyRunning()).toBe(true);
    });
  });
});
