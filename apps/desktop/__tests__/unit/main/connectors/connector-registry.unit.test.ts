/**
 * Unit tests for connector-registry.ts (via agent-core/common)
 *
 * Validates:
 * - All 8 built-in connectors are defined
 * - Callback ports are unique and within expected range (3118–3125)
 * - monday.com has force_install_if_needed in extraAuthParams
 * - getConnectorDefinition returns correct entries
 * - getMcpConnectorDefinitions excludes desktop-google and desktop-github
 */

import { describe, it, expect } from 'vitest';
import {
  getConnectorDefinitions,
  getConnectorDefinition,
  getMcpConnectorDefinitions,
  OAUTH_CALLBACK_PORTS,
  OAuthProviderId,
} from '@accomplish_ai/agent-core/common';

describe('connector registry', () => {
  it('defines exactly 8 built-in connectors', () => {
    const defs = getConnectorDefinitions();
    expect(defs).toHaveLength(8);
  });

  it('includes all expected provider IDs', () => {
    const defs = getConnectorDefinitions();
    const ids = defs.map((d) => d.id);
    expect(ids).toContain(OAuthProviderId.Slack);
    expect(ids).toContain(OAuthProviderId.Google);
    expect(ids).toContain(OAuthProviderId.Jira);
    expect(ids).toContain(OAuthProviderId.GitHub);
    expect(ids).toContain(OAuthProviderId.Monday);
    expect(ids).toContain(OAuthProviderId.Notion);
    expect(ids).toContain(OAuthProviderId.Lightdash);
    expect(ids).toContain(OAuthProviderId.Datadog);
  });

  it('has unique callback ports for all MCP-based connectors', () => {
    const ports = Object.values(OAUTH_CALLBACK_PORTS);
    const uniquePorts = new Set(ports);
    expect(uniquePorts.size).toBe(ports.length);
  });

  it('assigns callback ports in the range 3118–3125', () => {
    for (const port of Object.values(OAUTH_CALLBACK_PORTS)) {
      expect(port).toBeGreaterThanOrEqual(3118);
      expect(port).toBeLessThanOrEqual(3125);
    }
  });

  it('uses 127.0.0.1 (not localhost) for all callback hosts', () => {
    const defs = getConnectorDefinitions();
    for (const def of defs) {
      const oauth = def.desktopOAuth;
      if (oauth.kind === 'mcp-dcr' || oauth.kind === 'mcp-fixed-client') {
        expect(oauth.store.callback.host).toBe('127.0.0.1');
      }
    }
  });

  it('monday.com has force_install_if_needed in extraAuthParams', () => {
    const monday = getConnectorDefinition(OAuthProviderId.Monday);
    expect(monday).toBeDefined();
    const oauth = monday!.desktopOAuth;
    expect(oauth.kind).toBe('mcp-dcr');
    if (oauth.kind === 'mcp-dcr') {
      expect(oauth.extraAuthParams).toEqual(
        expect.objectContaining({ force_install_if_needed: 'true' }),
      );
    }
  });

  it('getConnectorDefinition returns undefined for unknown provider', () => {
    const result = getConnectorDefinition('unknown-provider' as OAuthProviderId);
    expect(result).toBeUndefined();
  });

  it('getMcpConnectorDefinitions excludes desktop-google and desktop-github', () => {
    const mcpDefs = getMcpConnectorDefinitions();
    for (const def of mcpDefs) {
      expect(def.desktopOAuth.kind).not.toBe('desktop-google');
      expect(def.desktopOAuth.kind).not.toBe('desktop-github');
    }
  });

  it('Lightdash and Datadog store server URL (storesServerUrl: true)', () => {
    const lightdash = getConnectorDefinition(OAuthProviderId.Lightdash);
    const datadog = getConnectorDefinition(OAuthProviderId.Datadog);

    expect(lightdash?.desktopOAuth.kind).toBe('mcp-dcr');
    expect(datadog?.desktopOAuth.kind).toBe('mcp-dcr');

    if (lightdash?.desktopOAuth.kind === 'mcp-dcr') {
      expect(lightdash.desktopOAuth.store.storesServerUrl).toBe(true);
    }
    if (datadog?.desktopOAuth.kind === 'mcp-dcr') {
      expect(datadog.desktopOAuth.store.storesServerUrl).toBe(true);
    }
  });

  it('Slack uses mcp-fixed-client strategy', () => {
    const slack = getConnectorDefinition(OAuthProviderId.Slack);
    expect(slack?.desktopOAuth.kind).toBe('mcp-fixed-client');
  });

  it('GitHub uses desktop-github strategy', () => {
    const github = getConnectorDefinition(OAuthProviderId.GitHub);
    expect(github?.desktopOAuth.kind).toBe('desktop-github');
  });
});
