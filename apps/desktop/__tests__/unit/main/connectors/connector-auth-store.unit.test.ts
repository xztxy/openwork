/**
 * Unit tests for ConnectorAuthStore
 *
 * Validates:
 * - Tokens stored and read correctly
 * - Optional lastOAuthValidatedAt handled when absent
 * - clearTokens() retains serverUrl (for Lightdash/Datadog)
 * - clearTokens() retains clientRegistration (for DCR providers)
 * - clearAuth() removes everything
 * - getOAuthStatus() reflects connected/disconnected/pending state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectorAuthStore } from '@main/connectors/connector-auth-store';
import type { ConnectorAuthStoreConfig } from '@accomplish_ai/agent-core/common';

// Mock the storage module
const mockStorage = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@main/store/storage', () => ({
  getStorage: () => mockStorage,
}));

function makeConfig(overrides: Partial<ConnectorAuthStoreConfig> = {}): ConnectorAuthStoreConfig {
  return {
    key: 'test-provider',
    serverUrl: 'https://mcp.example.com/mcp',
    usesDcr: true,
    storesServerUrl: false,
    callback: { host: '127.0.0.1', port: 3120, path: '/callback' },
    ...overrides,
  };
}

function makeStore(overrides: Partial<ConnectorAuthStoreConfig> = {}): ConnectorAuthStore {
  return new ConnectorAuthStore(makeConfig(overrides));
}

describe('ConnectorAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.get.mockReturnValue(undefined);
  });

  describe('getOAuthStatus()', () => {
    it('returns disconnected when no entry', () => {
      const store = makeStore();
      expect(store.getOAuthStatus()).toEqual({
        connected: false,
        pendingAuthorization: false,
        lastValidatedAt: undefined,
      });
    });

    it('returns connected when accessToken present', () => {
      mockStorage.get.mockReturnValue(
        JSON.stringify({ accessToken: 'tok123', lastOAuthValidatedAt: 1000 }),
      );
      const store = makeStore();
      const status = store.getOAuthStatus();
      expect(status.connected).toBe(true);
      expect(status.lastValidatedAt).toBe(1000);
    });

    it('returns connected when only refreshToken present', () => {
      mockStorage.get.mockReturnValue(JSON.stringify({ refreshToken: 'refresh123' }));
      const store = makeStore();
      expect(store.getOAuthStatus().connected).toBe(true);
    });

    it('returns pendingAuthorization when oauthState + codeVerifier present but no token', () => {
      mockStorage.get.mockReturnValue(
        JSON.stringify({ oauthState: 'state-abc', codeVerifier: 'verifier-xyz' }),
      );
      const store = makeStore();
      const status = store.getOAuthStatus();
      expect(status.connected).toBe(false);
      expect(status.pendingAuthorization).toBe(true);
    });

    it('handles missing lastOAuthValidatedAt gracefully', () => {
      mockStorage.get.mockReturnValue(JSON.stringify({ accessToken: 'tok' }));
      const store = makeStore();
      const status = store.getOAuthStatus();
      expect(status.connected).toBe(true);
      expect(status.lastValidatedAt).toBeUndefined();
    });
  });

  describe('setTokens()', () => {
    it('stores tokens and sets lastOAuthValidatedAt', () => {
      mockStorage.get.mockReturnValue(null);
      const store = makeStore();
      const ts = Date.now();
      store.setTokens({ accessToken: 'tok', tokenType: 'bearer', expiresAt: ts + 3600_000 }, ts);

      expect(mockStorage.set).toHaveBeenCalledWith(
        'connector-auth:test-provider',
        expect.stringContaining('"accessToken":"tok"'),
      );
      const written = JSON.parse(mockStorage.set.mock.calls[0][1]);
      expect(written.lastOAuthValidatedAt).toBe(ts);
    });

    it('sets lastOAuthValidatedAt to Date.now() when not provided', () => {
      const store = makeStore();
      const before = Date.now();
      store.setTokens({ accessToken: 'tok', tokenType: 'bearer' });
      const after = Date.now();
      const written = JSON.parse(mockStorage.set.mock.calls[0][1]);
      expect(written.lastOAuthValidatedAt).toBeGreaterThanOrEqual(before);
      expect(written.lastOAuthValidatedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('clearTokens()', () => {
    it('removes tokens but retains clientRegistration when usesDcr', () => {
      const reg = { clientId: 'client-id', clientSecret: 'secret' };
      mockStorage.get.mockReturnValue(
        JSON.stringify({ accessToken: 'tok', clientRegistration: reg }),
      );
      const store = makeStore({ usesDcr: true });
      store.clearTokens();
      const written = JSON.parse(mockStorage.set.mock.calls[0][1]);
      expect(written.accessToken).toBeUndefined();
      expect(written.clientRegistration).toEqual(reg);
    });

    it('retains serverUrl when storesServerUrl is true', () => {
      mockStorage.get.mockReturnValue(
        JSON.stringify({
          accessToken: 'tok',
          serverUrl: 'https://lightdash.example.com/api/v1/mcp',
        }),
      );
      const store = makeStore({ storesServerUrl: true, serverUrl: undefined });
      store.clearTokens();
      const written = JSON.parse(mockStorage.set.mock.calls[0][1]);
      expect(written.accessToken).toBeUndefined();
      expect(written.serverUrl).toBe('https://lightdash.example.com/api/v1/mcp');
    });

    it('deletes entry entirely when nothing to preserve', () => {
      mockStorage.get.mockReturnValue(JSON.stringify({ accessToken: 'tok' }));
      const store = makeStore({ usesDcr: false, storesServerUrl: false });
      store.clearTokens();
      // deleteEntry writes empty string
      expect(mockStorage.set).toHaveBeenCalledWith('connector-auth:test-provider', '');
    });

    it('does nothing when entry is absent', () => {
      mockStorage.get.mockReturnValue(null);
      const store = makeStore();
      store.clearTokens();
      expect(mockStorage.set).not.toHaveBeenCalled();
    });
  });

  describe('clearAuth()', () => {
    it('deletes entire entry including client registration', () => {
      mockStorage.get.mockReturnValue(
        JSON.stringify({ accessToken: 'tok', clientRegistration: { clientId: 'x' } }),
      );
      const store = makeStore();
      store.clearAuth();
      expect(mockStorage.set).toHaveBeenCalledWith('connector-auth:test-provider', '');
    });
  });

  describe('getRefreshToken()', () => {
    it('returns refresh token from stored entry', () => {
      mockStorage.get.mockReturnValue(JSON.stringify({ refreshToken: 'refresh-tok' }));
      const store = makeStore();
      expect(store.getRefreshToken()).toBe('refresh-tok');
    });

    it('returns undefined when no entry', () => {
      const store = makeStore();
      expect(store.getRefreshToken()).toBeUndefined();
    });
  });

  describe('getServerUrl()', () => {
    it('returns static serverUrl from config when set', () => {
      const store = makeStore({ serverUrl: 'https://static.example.com/mcp' });
      expect(store.getServerUrl()).toBe('https://static.example.com/mcp');
    });

    it('reads serverUrl from stored entry when storesServerUrl is true', () => {
      mockStorage.get.mockReturnValue(
        JSON.stringify({ serverUrl: 'https://dynamic.example.com/mcp' }),
      );
      const store = makeStore({ serverUrl: undefined, storesServerUrl: true });
      expect(store.getServerUrl()).toBe('https://dynamic.example.com/mcp');
    });
  });
});
