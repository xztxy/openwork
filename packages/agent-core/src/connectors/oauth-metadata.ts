import type { OAuthMetadata } from '../common/types/connector.js';

const OAUTH_FETCH_TIMEOUT_MS = 30_000;

export interface OAuthProtectedResourceMetadata {
  resource: string;
  authorizationServers?: string[];
  bearerMethodsSupported?: string[];
  scopesSupported?: string[];
  resourceName?: string;
  resourceDocumentation?: string;
}

export function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OAUTH_FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${OAUTH_FETCH_TIMEOUT_MS}ms`);
      }
      throw err;
    })
    .finally(() => clearTimeout(timeoutId));
}

/**
 * Discover OAuth 2.0 authorization server metadata from an MCP server URL.
 * Fetches from {serverUrl}/.well-known/oauth-authorization-server
 */
export async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
  const url = new URL('/.well-known/oauth-authorization-server', serverUrl);
  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to discover OAuth metadata from ${url.toString()}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  const authorizationEndpoint = data.authorization_endpoint as string | undefined;
  const tokenEndpoint = data.token_endpoint as string | undefined;

  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error('Invalid OAuth metadata: missing authorization_endpoint or token_endpoint');
  }

  return {
    issuer: data.issuer as string | undefined,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: data.registration_endpoint as string | undefined,
    scopesSupported: data.scopes_supported as string[] | undefined,
  };
}

/**
 * Discover OAuth protected resource metadata from an MCP server's 401 challenge.
 * Fetches the URL advertised in the WWW-Authenticate `resource_metadata` parameter.
 */
export async function discoverOAuthProtectedResourceMetadata(
  serverUrl: string,
): Promise<OAuthProtectedResourceMetadata> {
  const response = await fetchWithTimeout(serverUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (response.status !== 401) {
    throw new Error(
      `Expected ${serverUrl} to return 401 with OAuth metadata, got ${response.status} ${response.statusText}`,
    );
  }

  const authenticateHeader = response.headers.get('www-authenticate');
  // RFC 7235 allows optional whitespace around `=` in auth-params
  const metadataUrlMatch = authenticateHeader?.match(/\bresource_metadata\s*=\s*"([^"]+)"/i);
  const metadataUrl = metadataUrlMatch?.[1];

  let metadataResponse: Response | undefined;
  let lastError: Error | undefined;

  if (metadataUrl) {
    try {
      metadataResponse = await fetchWithTimeout(metadataUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!metadataResponse.ok) {
        lastError = new Error(
          `HTTP ${metadataResponse.status} ${metadataResponse.statusText} from header url`,
        );
        metadataResponse = undefined;
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      metadataResponse = undefined;
    }
  }

  if (!metadataResponse || !metadataResponse.ok) {
    // Preserve any subpath on serverUrl (e.g. /mcp) so subpath-mounted servers
    // resolve to the correct well-known document rather than origin root.
    const resourceUrl = new URL(serverUrl);
    const resourcePath = resourceUrl.pathname === '/' ? '' : resourceUrl.pathname;
    const wellKnownUrl = new URL(
      `/.well-known/oauth-protected-resource${resourcePath}`,
      resourceUrl.origin,
    ).toString();
    try {
      metadataResponse = await fetchWithTimeout(wellKnownUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!metadataResponse.ok) {
        lastError = new Error(
          `HTTP ${metadataResponse.status} ${metadataResponse.statusText} from well-known url`,
        );
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!metadataResponse || !metadataResponse.ok) {
    throw new Error(
      `Failed to discover protected resource metadata for ${serverUrl}: ${lastError?.message || 'Unknown error'}`,
    );
  }

  const contentType = metadataResponse.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `Protected resource metadata endpoint returned non-JSON response (Content-Type: ${contentType || 'none'})`,
    );
  }

  const data = (await metadataResponse.json()) as Record<string, unknown>;
  const resource = data.resource as string | undefined;
  if (!resource) {
    throw new Error('Invalid protected resource metadata: missing resource');
  }

  return {
    resource,
    authorizationServers: data.authorization_servers as string[] | undefined,
    bearerMethodsSupported: data.bearer_methods_supported as string[] | undefined,
    scopesSupported: data.scopes_supported as string[] | undefined,
    resourceName: data.resource_name as string | undefined,
    resourceDocumentation: data.resource_documentation as string | undefined,
  };
}
