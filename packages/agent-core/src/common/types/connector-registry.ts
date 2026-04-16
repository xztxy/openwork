import { OAuthProviderId } from './connector.js';
import type { ConnectorDefinition } from './connector.js';

// OAuth callback ports — unique per provider (ADR-F001, research.md)
export const OAUTH_CALLBACK_PORTS = {
  slack: 3118,
  google: 3119,
  jira: 3120,
  github: 3121,
  lightdash: 3122,
  notion: 3123,
  monday: 3124,
  datadog: 3125,
} as const;

const CONNECTOR_REGISTRY: readonly ConnectorDefinition[] = [
  {
    id: OAuthProviderId.Slack,
    displayName: 'Slack',
    referencePrompt:
      'The user explicitly mentioned @Slack in their prompt. ' +
      'Prioritize using the Slack MCP tools for this task.',
    desktopOAuth: {
      kind: 'mcp-fixed-client',
      clientId: '1601185624273.8899143856786',
      store: {
        key: 'slack',
        serverUrl: 'https://mcp.slack.com/mcp',
        usesDcr: false,
        storesServerUrl: false,
        callback: { host: '127.0.0.1', port: OAUTH_CALLBACK_PORTS.slack, path: '/callback' },
      },
      discoveryError:
        'Slack authentication failed during OAuth discovery — could not reach mcp.slack.com. Check your internet connection.',
      tokenExchangeError:
        'Slack authentication failed during token exchange — the server rejected the authorization code. Try again in a few minutes.',
    },
  },
  {
    id: OAuthProviderId.Google,
    displayName: 'Google Drive',
    referencePrompt:
      'The user explicitly mentioned @Google Drive in their prompt. ' +
      'Prioritize using Google Workspace MCP tools for this task.',
    desktopOAuth: {
      kind: 'desktop-google',
    },
  },
  {
    id: OAuthProviderId.Jira,
    displayName: 'Jira',
    referencePrompt:
      'The user explicitly mentioned @Jira in their prompt. ' +
      'Prioritize using the Jira MCP tools for this task.',
    desktopOAuth: {
      kind: 'mcp-dcr',
      store: {
        key: 'jira',
        serverUrl: 'https://mcp.atlassian.com/v1/mcp',
        usesDcr: true,
        storesServerUrl: false,
        callback: { host: '127.0.0.1', port: OAUTH_CALLBACK_PORTS.jira, path: '/callback' },
      },
      discoveryError:
        'Jira authentication failed during OAuth discovery — could not reach mcp.atlassian.com. Check your internet connection.',
      registrationError:
        'Jira authentication failed during client registration — the Atlassian server rejected the registration request. Ask your Atlassian admin to check Settings > Security > AI settings > Rovo MCP server.',
      tokenExchangeError:
        'Jira authentication failed during token exchange — the server rejected the authorization code. Try again in a few minutes.',
    },
  },
  {
    id: OAuthProviderId.GitHub,
    displayName: 'GitHub',
    referencePrompt:
      'The user explicitly mentioned @GitHub in their prompt. ' +
      'Use the `gh` CLI via bash for GitHub operations.',
    desktopOAuth: {
      kind: 'desktop-github',
    },
  },
  {
    id: OAuthProviderId.Monday,
    displayName: 'monday.com',
    referencePrompt:
      'The user explicitly mentioned @monday.com in their prompt. ' +
      'Prioritize using the monday.com MCP tools for this task.',
    desktopOAuth: {
      kind: 'mcp-dcr',
      store: {
        key: 'monday',
        serverUrl: 'https://mcp.monday.com/mcp',
        usesDcr: true,
        storesServerUrl: false,
        callback: { host: '127.0.0.1', port: OAUTH_CALLBACK_PORTS.monday, path: '/callback' },
      },
      discoveryError:
        'monday.com authentication failed during OAuth discovery — could not reach mcp.monday.com. Check your internet connection.',
      registrationError:
        'monday.com authentication failed during client registration — the monday.com server rejected the request.',
      tokenExchangeError:
        'monday.com authentication failed during token exchange — the server rejected the authorization code. Try again in a few minutes.',
      extraAuthParams: { force_install_if_needed: 'true' },
    },
  },
  {
    id: OAuthProviderId.Notion,
    displayName: 'Notion',
    referencePrompt:
      'The user explicitly mentioned @Notion in their prompt. ' +
      'Prioritize using the Notion MCP tools for this task.',
    desktopOAuth: {
      kind: 'mcp-dcr',
      store: {
        key: 'notion',
        serverUrl: 'https://mcp.notion.com/mcp',
        usesDcr: true,
        storesServerUrl: false,
        callback: { host: '127.0.0.1', port: OAUTH_CALLBACK_PORTS.notion, path: '/callback' },
      },
      discoveryError:
        'Notion authentication failed during OAuth discovery — could not reach mcp.notion.com. Check your internet connection.',
      registrationError:
        'Notion authentication failed during client registration — check that your Notion account has API access enabled.',
      tokenExchangeError:
        'Notion authentication failed during token exchange — the server rejected the authorization code. Try again in a few minutes.',
    },
  },
  {
    id: OAuthProviderId.Lightdash,
    displayName: 'Lightdash',
    referencePrompt:
      'The user explicitly mentioned @Lightdash in their prompt. ' +
      'Prioritize using the Lightdash MCP tools for data exploration and metric queries.',
    desktopOAuth: {
      kind: 'mcp-dcr',
      store: {
        key: 'lightdash',
        usesDcr: true,
        storesServerUrl: true,
        callback: { host: '127.0.0.1', port: OAUTH_CALLBACK_PORTS.lightdash, path: '/callback' },
      },
      discoveryError:
        'Lightdash authentication failed during OAuth discovery — could not reach your Lightdash instance. Check your internet connection and verify the instance URL.',
      registrationError:
        'Lightdash authentication failed during client registration — check that your Lightdash instance supports MCP OAuth.',
      tokenExchangeError:
        'Lightdash authentication failed during token exchange — the server rejected the authorization code. Try again in a few minutes.',
    },
  },
  {
    id: OAuthProviderId.Datadog,
    displayName: 'Datadog',
    referencePrompt:
      'The user explicitly mentioned @Datadog in their prompt. ' +
      'Prioritize using the Datadog MCP tools for observability — logs, monitors, metrics, dashboards, SLOs, incidents, and traces.',
    desktopOAuth: {
      kind: 'mcp-dcr',
      store: {
        key: 'datadog',
        usesDcr: true,
        storesServerUrl: true,
        callback: { host: '127.0.0.1', port: OAUTH_CALLBACK_PORTS.datadog, path: '/callback' },
      },
      discoveryError:
        'Datadog authentication failed during OAuth discovery — could not reach your Datadog MCP endpoint. Check your internet connection and verify the Datadog site is correct.',
      registrationError:
        'Datadog authentication failed during client registration — check that your Datadog site supports MCP OAuth.',
      tokenExchangeError:
        'Datadog authentication failed during token exchange — the server rejected the authorization code. Try again in a few minutes.',
    },
  },
];

export function getConnectorDefinitions(): readonly ConnectorDefinition[] {
  return CONNECTOR_REGISTRY;
}

export function getConnectorDefinition(id: OAuthProviderId): ConnectorDefinition | undefined {
  return CONNECTOR_REGISTRY.find((d) => d.id === id);
}

/** Returns all connectors that have an MCP-based OAuth strategy (excludes desktop-github) */
export function getMcpConnectorDefinitions(): readonly ConnectorDefinition[] {
  return CONNECTOR_REGISTRY.filter(
    (d) => d.desktopOAuth.kind !== 'desktop-google' && d.desktopOAuth.kind !== 'desktop-github',
  );
}
