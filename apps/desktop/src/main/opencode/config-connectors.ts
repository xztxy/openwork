/**
 * Connector token resolution for OpenCode config generation.
 * Handles fetching enabled connectors and refreshing expired tokens.
 */
import { isTokenExpired, refreshAccessToken } from '@accomplish_ai/agent-core';
import { getStorage } from '../store/storage';
import { getLogCollector } from '../logging';

function logOC(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(level, 'opencode', msg, data);
    }
  } catch (_e) {
    /* best-effort logging */
  }
}

export interface ConnectorEntry {
  id: string;
  name: string;
  url: string;
  accessToken: string;
}

/**
 * Fetch enabled connectors with valid (possibly refreshed) access tokens.
 * Returns only connectors that have a usable access token.
 */
export async function resolveEnabledConnectors(): Promise<ConnectorEntry[]> {
  const storage = getStorage();
  const enabledConnectors = storage.getEnabledConnectors();
  const connectors: ConnectorEntry[] = [];

  for (const connector of enabledConnectors) {
    if (connector.status !== 'connected') {
      continue;
    }

    let tokens = storage.getConnectorTokens(connector.id);
    if (!tokens?.accessToken) {
      logOC('WARN', `[Connectors] Missing access token for ${connector.name}`);
      storage.setConnectorStatus(connector.id, 'error');
      continue;
    }

    // Refresh token if expired
    if (isTokenExpired(tokens)) {
      if (tokens.refreshToken && connector.oauthMetadata && connector.clientRegistration) {
        try {
          tokens = await refreshAccessToken({
            tokenEndpoint: connector.oauthMetadata.tokenEndpoint,
            refreshToken: tokens.refreshToken,
            clientId: connector.clientRegistration.clientId,
            clientSecret: connector.clientRegistration.clientSecret,
          });
          storage.storeConnectorTokens(connector.id, tokens);
        } catch (err) {
          logOC('WARN', `[Connectors] Token refresh failed for ${connector.name}`, {
            err: String(err),
          });
          storage.setConnectorStatus(connector.id, 'error');
          continue;
        }
      } else {
        logOC(
          'WARN',
          `[Connectors] Access token expired for ${connector.name} and cannot be refreshed`,
        );
        storage.setConnectorStatus(connector.id, 'error');
        continue;
      }
    }

    connectors.push({
      id: connector.id,
      name: connector.name,
      url: connector.url,
      accessToken: tokens.accessToken,
    });
  }

  return connectors;
}
