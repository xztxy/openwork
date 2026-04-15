/**
 * MCP server configuration builder for OpenCode config generation.
 * Extracted from config-generator.ts to keep that file focused on high-level orchestration.
 */
import path from 'path';
import fs from 'fs';
import { OPENCODE_SLACK_MCP_SERVER_URL, OPENCODE_SLACK_MCP_CLIENT_ID } from './auth.js';
import { MCP_TOOL_TIMEOUT_MS } from '../common/constants.js';

/** Browser automation mode for task execution. */
export interface BrowserConfig {
  /** 'builtin' = dev-browser HTTP server (default), 'remote' = connect to CDP endpoint, 'none' = no browser */
  mode: 'builtin' | 'remote' | 'none';
  /** For 'remote': the CDP endpoint URL */
  cdpEndpoint?: string;
  /** For 'remote': auth headers (e.g. { 'X-CDP-Secret': '...' }) */
  cdpHeaders?: Record<string, string>;
  /** For 'builtin': run headless */
  headless?: boolean;
}

export interface McpServerConfig {
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  environment?: Record<string, string>;
  timeout?: number;
  oauth?:
    | false
    | {
        clientId?: string;
        clientSecret?: string;
        scope?: string;
      };
}

function resolveMcpCommand(
  mcpToolsPath: string,
  mcpName: string,
  distRelPath: string,
  nodePath: string,
): string[] {
  const mcpDir = path.join(mcpToolsPath, mcpName);
  const distPath = path.join(mcpDir, distRelPath);
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `[OpenCode Config] Missing MCP dist entry: ${distPath}. ` +
        'Run "pnpm -F @accomplish/desktop build:mcp-tools:dev" before launching.',
    );
  }
  return [nodePath, distPath];
}

export interface BuildMcpServersOptions {
  mcpToolsPath: string;
  nodeExe: string;
  permissionApiPort: number;
  questionApiPort: number;
  /** Port for the WhatsApp HTTP API (daemon). Omit to disable the tool. */
  whatsappApiPort?: number;
  browserConfig: BrowserConfig;
  /** Auth token for daemon HTTP APIs. MCP tools send this as Authorization header. */
  authToken?: string;
  connectors?: Array<{
    id: string;
    name: string;
    url: string;
    accessToken: string;
  }>;
  /**
   * Path to GWS accounts manifest JSON. When set, gmail-mcp, calendar-mcp,
   * and gws-mcp are registered and receive this path via GWS_ACCOUNTS_MANIFEST.
   */
  gwsAccountsManifestPath?: string;
}

/**
 * Builds the MCP server configuration map for OpenCode.
 * Includes built-in tools, browser config, and connected remote MCP connectors.
 */
export function buildMcpServers(options: BuildMcpServersOptions): Record<string, McpServerConfig> {
  const {
    mcpToolsPath,
    nodeExe,
    // permissionApiPort / questionApiPort are retained on the options type
    // for back-compat with existing call sites (Phase 3 of the SDK cutover
    // port removed the file-permission and ask-user-question MCP entries).
    permissionApiPort: _permissionApiPort,
    questionApiPort: _questionApiPort,
    whatsappApiPort,
    browserConfig,
    authToken,
    connectors,
    gwsAccountsManifestPath,
  } = options;

  // Auth env for daemon HTTP APIs — MCP tools send this as Authorization header
  const authEnv: Record<string, string> = authToken
    ? { ACCOMPLISH_DAEMON_AUTH_TOKEN: authToken }
    : {};

  const mcpServers: Record<string, McpServerConfig> = {
    slack: {
      type: 'remote',
      url: OPENCODE_SLACK_MCP_SERVER_URL,
      oauth: { clientId: OPENCODE_SLACK_MCP_CLIENT_ID },
    },
    // Phase 3 of the OpenCode SDK cutover port removed the `file-permission`
    // and `ask-user-question` MCP entries — their HTTP-callback role was
    // replaced by the SDK's native `permission.asked` / `question.asked`
    // events handled inside `OpenCodeAdapter`. The `permissionApiPort` /
    // `questionApiPort` parameters are retained in this builder's signature
    // for back-compat with existing call sites; the daemon no longer listens
    // on those ports.
    'request-connector-auth': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'request-connector-auth', 'dist/index.mjs', nodeExe),
      enabled: true,
      environment: { ...authEnv },
      timeout: MCP_TOOL_TIMEOUT_MS,
    },
    'complete-task': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'complete-task', 'dist/index.mjs', nodeExe),
      enabled: true,
      timeout: 30000,
    },
    'start-task': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'start-task', 'dist/index.mjs', nodeExe),
      enabled: true,
      timeout: 30000,
    },
    'desktop-control': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'desktop-control', 'dist/index.mjs', nodeExe),
      enabled: true,
      // Phase 3 of the SDK cutover port removed the daemon's
      // /permission HTTP listener, so `PERMISSION_API_PORT` no longer points
      // at anything. If desktop-control needs to route permission prompts
      // it should do so via the task emitter / RPC chain like any other
      // tool — not by direct HTTP to a defunct listener.
      environment: { ...authEnv },
      timeout: 60000,
    },
  };

  if (whatsappApiPort) {
    mcpServers['whatsapp'] = {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'whatsapp', 'dist/index.mjs', nodeExe),
      enabled: true,
      environment: {
        ACCOMPLISH_WHATSAPP_API_PORT: String(whatsappApiPort),
        ...authEnv,
      },
      timeout: 30000,
    };
  }

  if (browserConfig.mode !== 'none') {
    const browserEnv: Record<string, string> = {};
    if (browserConfig.mode === 'remote') {
      if (browserConfig.cdpEndpoint) {
        browserEnv.CDP_ENDPOINT = browserConfig.cdpEndpoint;
      }
      if (browserConfig.cdpHeaders) {
        for (const [key, value] of Object.entries(browserConfig.cdpHeaders)) {
          if (key.toLowerCase() === 'x-cdp-secret') {
            browserEnv.CDP_SECRET = value;
          }
        }
      }
    }
    mcpServers['dev-browser-mcp'] = {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'dev-browser-mcp', 'dist/index.mjs', nodeExe),
      enabled: true,
      ...(Object.keys(browserEnv).length > 0 && { environment: browserEnv }),
      timeout: 30000,
    };
  }

  if (gwsAccountsManifestPath) {
    const gwsEnv = { GWS_ACCOUNTS_MANIFEST: gwsAccountsManifestPath };
    try {
      mcpServers['gmail-mcp'] = {
        type: 'local',
        command: resolveMcpCommand(mcpToolsPath, 'gmail-mcp', 'dist/index.mjs', nodeExe),
        enabled: true,
        environment: gwsEnv,
        timeout: 60000,
      };
    } catch {
      // gmail-mcp not available (not yet built or installed)
    }
    try {
      mcpServers['calendar-mcp'] = {
        type: 'local',
        command: resolveMcpCommand(mcpToolsPath, 'calendar-mcp', 'dist/index.mjs', nodeExe),
        enabled: true,
        environment: gwsEnv,
        timeout: 60000,
      };
    } catch {
      // calendar-mcp not available
    }
    try {
      mcpServers['gws-mcp'] = {
        type: 'local',
        command: resolveMcpCommand(mcpToolsPath, 'gws-mcp', 'dist/index.mjs', nodeExe),
        enabled: true,
        environment: gwsEnv,
        timeout: 60000,
      };
    } catch {
      // gws-mcp not available (requires @googleworkspace/cli)
    }
    try {
      mcpServers['request-google-file-picker'] = {
        type: 'local',
        command: resolveMcpCommand(
          mcpToolsPath,
          'request-google-file-picker',
          'dist/index.mjs',
          nodeExe,
        ),
        enabled: true,
        environment: gwsEnv,
        timeout: 30000,
      };
    } catch {
      // request-google-file-picker not available
    }
  }

  if (connectors) {
    for (const connector of connectors) {
      const sanitized = connector.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20);
      const baseName = sanitized || 'mcp-remote';
      const idSuffix = connector.id.slice(0, 6);
      let key = `connector-${baseName}-${idSuffix}`;
      if (mcpServers[key]) {
        let i = 1;
        while (mcpServers[`${key}-${i}`]) {
          i += 1;
        }
        key = `${key}-${i}`;
      }
      mcpServers[key] = {
        type: 'remote',
        url: connector.url,
        headers: { Authorization: `Bearer ${connector.accessToken}` },
        enabled: true,
      };
    }
  }

  return mcpServers;
}
