import path from 'path';
import fs from 'fs';
import type { ProviderId } from '../common/types/providerSettings.js';
import type { Skill } from '../common/types/skills.js';
import { OPENCODE_SLACK_MCP_SERVER_URL, OPENCODE_SLACK_MCP_CLIENT_ID } from './auth.js';
import { MCP_TOOL_TIMEOUT_MS } from '../common/constants.js';
import { createConsoleLogger } from '../utils/logging.js';
import {
  getPlatformEnvironmentInstructions,
  ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE,
} from './system-prompt.js';

const log = createConsoleLogger({ prefix: 'OpenCodeConfig' });

export const ACCOMPLISH_AGENT_NAME = 'accomplish';

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

export interface ConfigGeneratorOptions {
  platform: NodeJS.Platform;
  mcpToolsPath: string;
  provider?: {
    id: ProviderId;
    model: string;
    baseUrl?: string;
  };
  apiKey?: string;
  skills?: Skill[];
  bundledNodeBinPath?: string;
  isPackaged: boolean;
  providerConfigs?: ProviderConfig[];
  azureFoundryToken?: string;
  permissionApiPort?: number;
  questionApiPort?: number;
  /** Optional auth token for daemon API endpoints */
  authToken?: string;
  userDataPath: string;
  model?: string;
  smallModel?: string;
  enabledProviders?: string[];
  /** Browser configuration. Defaults to { mode: 'builtin' } */
  browser?: BrowserConfig;
  /** Connected MCP remote servers with OAuth access tokens */
  connectors?: Array<{
    id: string;
    name: string;
    url: string;
    accessToken: string;
  }>;
  /** Formatted workspace knowledge notes to inject into the system prompt */
  knowledgeNotes?: string;
}

export interface ProviderConfig {
  id: string;
  npm?: string;
  name?: string;
  options: Record<string, unknown>;
  models?: Record<string, ProviderModelConfig>;
}

export interface ProviderModelConfig {
  name: string;
  tools?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  options?: Record<string, unknown>;
}

export interface GeneratedConfig {
  systemPrompt: string;
  mcpServers: Record<string, McpServerConfig>;
  environment: Record<string, string>;
  config: OpenCodeConfigFile;
  configPath: string;
}

interface McpServerConfig {
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

interface AgentConfig {
  description?: string;
  prompt?: string;
  mode?: 'primary' | 'subagent' | 'all';
}

interface OpenCodeConfigFile {
  $schema?: string;
  model?: string;
  small_model?: string;
  default_agent?: string;
  enabled_providers?: string[];
  permission?: string | Record<string, string | Record<string, string>>;
  agent?: Record<string, AgentConfig>;
  mcp?: Record<string, McpServerConfig>;
  provider?: Record<string, Omit<ProviderConfig, 'id'>>;
  plugin?: string[];
  experimental?: Record<string, unknown>;
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

export function generateConfig(options: ConfigGeneratorOptions): GeneratedConfig {
  const {
    platform,
    mcpToolsPath,
    skills = [],
    bundledNodeBinPath,
    providerConfigs = [],
    permissionApiPort = 9226,
    questionApiPort = 9227,
    userDataPath,
    model,
    smallModel,
    enabledProviders: customEnabledProviders,
  } = options;

  const environmentInstructions = getPlatformEnvironmentInstructions(platform);
  let systemPrompt = ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE.replace(
    /\{\{ENVIRONMENT_INSTRUCTIONS\}\}/g,
    environmentInstructions,
  );

  if (skills.length > 0) {
    const skillsSection = `

<available-skills>
##############################################################################
# SKILLS - Include relevant ones in your start_task call
##############################################################################

Review these skills and include any relevant ones in your start_task call's \`skills\` array.
After calling start_task, you MUST read the SKILL.md file for each skill you listed.

**Available Skills:**

${skills
  .map(
    (s) => `- **${s.name}** (${s.command}): ${s.description}
  File: ${s.filePath}`,
  )
  .join('\n\n')}

Use empty array [] if no skills apply to your task.

##############################################################################
</available-skills>
`;
    systemPrompt += skillsSection;
  }

  if (options.knowledgeNotes) {
    const knowledgeSection = `

<workspace-knowledge>
##############################################################################
# WORKSPACE KNOWLEDGE - Persistent context for this workspace
##############################################################################

The user has saved the following knowledge notes for this workspace.
Use this information as context for all tasks. Do not ask the user to
re-explain anything covered here.

${options.knowledgeNotes}

##############################################################################
</workspace-knowledge>
`;
    systemPrompt += knowledgeSection;
  }

  if (!bundledNodeBinPath) {
    throw new Error(
      '[OpenCode Config] Missing bundled Node.js path; cannot launch MCP tools. ' +
        'Run "pnpm -F @accomplish/desktop download:nodejs" and rebuild artifacts.',
    );
  }

  const nodeExe = path.join(bundledNodeBinPath, platform === 'win32' ? 'node.exe' : 'node');
  if (!fs.existsSync(nodeExe)) {
    throw new Error(`[OpenCode Config] Missing bundled Node.js executable: ${nodeExe}`);
  }

  const mcpServers: Record<string, McpServerConfig> = {
    slack: {
      type: 'remote',
      url: OPENCODE_SLACK_MCP_SERVER_URL,
      oauth: {
        clientId: OPENCODE_SLACK_MCP_CLIENT_ID,
      },
    },
    'file-permission': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'file-permission', 'dist/index.mjs', nodeExe),
      enabled: true,
      environment: {
        PERMISSION_API_PORT: String(permissionApiPort),
      },
      timeout: 30000,
    },
    'ask-user-question': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'ask-user-question', 'dist/index.mjs', nodeExe),
      enabled: true,
      environment: {
        QUESTION_API_PORT: String(questionApiPort),
      },
      timeout: 600000, // 10 minutes — user needs time to read and respond
    },
    'request-connector-auth': {
      type: 'local',
      command: resolveMcpCommand(mcpToolsPath, 'request-connector-auth', 'dist/index.mjs', nodeExe),
      enabled: true,
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
      environment: {
        PERMISSION_API_PORT: String(permissionApiPort),
      },
      timeout: 60000,
    },
  };

  // Conditionally register dev-browser-mcp based on browser config
  const browserConfig = options.browser ?? { mode: 'builtin' };

  if (browserConfig.mode !== 'none') {
    const browserEnv: Record<string, string> = {};

    if (browserConfig.mode === 'remote') {
      if (browserConfig.cdpEndpoint) {
        browserEnv.CDP_ENDPOINT = browserConfig.cdpEndpoint;
      }
      if (browserConfig.cdpHeaders) {
        for (const [key, value] of Object.entries(browserConfig.cdpHeaders)) {
          if (key === 'X-CDP-Secret') {
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

  // Add connected MCP connectors as remote servers
  if (options.connectors) {
    for (const connector of options.connectors) {
      // Use short sanitized name + ID suffix as key to prevent collisions
      const sanitized = connector.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20);
      const baseName = sanitized || 'mcp-remote';
      const idSuffix = connector.id.slice(0, 6);
      let key = `connector-${baseName}-${idSuffix}`;
      // Guard against unlikely collision with existing keys
      if (mcpServers[key]) {
        let i = 1;
        while (mcpServers[`${key}-${i}`]) i += 1;
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

  // Fill browser-specific template sections based on mode
  const hasBrowser = browserConfig.mode !== 'none';
  systemPrompt = systemPrompt
    .replace('{{AGENT_ROLE}}', hasBrowser ? 'browser automation' : 'task automation')
    .replace(
      '{{BROWSER_CAPABILITY}}',
      hasBrowser
        ? '- **Browser Automation**: Control web browsers, navigate sites, fill forms, click buttons\n'
        : '',
    )
    .replace(
      '{{BROWSER_BEHAVIOR}}',
      hasBrowser
        ? `- **NEVER use shell commands (open, xdg-open, start, subprocess, webbrowser) to open browsers or URLs** - these open the user's default browser, not the automation-controlled Chrome. ALL browser operations MUST use browser_* MCP tools.
- For multi-step browser workflows, prefer \`browser_script\` over individual tools - it's faster and auto-returns page state.
- **For collecting data from multiple pages** (e.g. comparing listings, gathering info from search results), use \`browser_batch_actions\` to extract data from multiple URLs in ONE call instead of visiting each page individually with click/snapshot loops. First collect the URLs from the search results page, then pass them all to \`browser_batch_actions\` with a JS extraction script.

**BROWSER ACTION VERBOSITY - Balance clarity with conciseness:**
- Provide brief, informative updates about web interactions - enough context to understand progress, but avoid excessive detail
- After navigation: briefly mention the page or what's visible if relevant
- After clicking: note what happened if it's significant (page change, form appeared, error occurred)
- After typing: only confirm if the input is important to track
- When analyzing snapshots: summarize key findings concisely
- If something unexpected happens: explain what you see and how you'll adapt

Aim for a middle ground: informative but not overly verbose. Different models have different natural verbosity levels - find a balance that's clear without being excessive.

Example balanced narration:
"Navigating to Google... Search page loaded. Searching for 'cute animals'... Results page showing animal images and links."

Example too verbose (avoid):
"I'll navigate to Google... The search page is loaded. I can see the search box. Let me search for 'cute animals'... Typing in the search field and pressing Enter... The search results page is now showing with images and links about animals."

Example too terse (avoid):
"Done." or "Navigated." or "Clicked."

- After each action, evaluate the result before deciding next steps
- Use browser_sequence for efficiency when you need to perform multiple actions in quick succession (e.g., filling a form with multiple fields)
`
        : '',
    );

  const providerConfig: Record<string, Omit<ProviderConfig, 'id'>> = {};
  for (const provider of providerConfigs) {
    const { id, ...rest } = provider;
    providerConfig[id] = rest;
  }

  let enabledProviders: string[];
  if (customEnabledProviders) {
    enabledProviders = [...new Set([...customEnabledProviders, ...Object.keys(providerConfig)])];
  } else {
    const baseProviders = [
      'anthropic',
      'openai',
      'openrouter',
      'google',
      'xai',
      'deepseek',
      'moonshot',
      'zai-coding-plan',
      'amazon-bedrock',
      'minimax',
      'venice',
    ];
    enabledProviders = [...new Set([...baseProviders, ...Object.keys(providerConfig)])];
  }

  const config: OpenCodeConfigFile = {
    $schema: 'https://opencode.ai/config.json',
    ...(model && { model }),
    ...(smallModel && { small_model: smallModel }),
    default_agent: ACCOMPLISH_AGENT_NAME,
    enabled_providers: enabledProviders,
    permission: {
      '*': 'allow',
      todowrite: 'allow',
    },
    provider: Object.keys(providerConfig).length > 0 ? providerConfig : undefined,
    plugin: ['@tarquinen/opencode-dcp@^2.0.0'],
    agent: {
      [ACCOMPLISH_AGENT_NAME]: {
        description: 'Browser automation assistant using dev-browser',
        prompt: systemPrompt,
        mode: 'primary',
      },
    },
    mcp: mcpServers,
    experimental: {
      mcp_timeout: 600000, // 10 minutes — allow long-running MCP tools like AskUserQuestion
    },
  };

  const configDir = path.join(userDataPath, 'opencode');
  const configPath = path.join(configDir, 'opencode.json');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configJson = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, configJson);

  log.info(`[OpenCode Config] Generated config at: ${configPath}`);

  const environment: Record<string, string> = {
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_DIR: configDir,
  };

  if (bundledNodeBinPath) {
    environment.NODE_BIN_PATH = bundledNodeBinPath;
  }

  return {
    systemPrompt,
    mcpServers,
    environment,
    config,
    configPath,
  };
}

export function getOpenCodeConfigPath(userDataPath: string): string {
  return path.join(userDataPath, 'opencode', 'opencode.json');
}

export interface BuildCliArgsOptions {
  prompt: string;
  sessionId?: string;
  selectedModel?: {
    provider: string;
    model: string;
  } | null;
}

export function buildCliArgs(options: BuildCliArgsOptions): string[] {
  const { prompt, sessionId, selectedModel } = options;

  const args: string[] = ['run'];

  // CRITICAL: JSON format required for StreamParser to parse messages
  args.push('--format', 'json');

  if (selectedModel?.model) {
    if (selectedModel.provider === 'zai') {
      const modelId = selectedModel.model.split('/').pop();
      args.push('--model', `zai-coding-plan/${modelId}`);
    } else if (selectedModel.provider === 'deepseek') {
      const modelId = selectedModel.model.split('/').pop();
      args.push('--model', `deepseek/${modelId}`);
    } else if (selectedModel.provider === 'openrouter') {
      args.push('--model', selectedModel.model);
    } else if (selectedModel.provider === 'ollama') {
      // Accept both "qwen3:4b" and "ollama/qwen3:4b" inputs consistently
      const normalizedModelId = selectedModel.model.replace(/^ollama\//, '');
      args.push('--model', `ollama/${normalizedModelId}`);
    } else if (selectedModel.provider === 'litellm') {
      const modelId = selectedModel.model.replace(/^litellm\//, '');
      args.push('--model', `litellm/${modelId}`);
    } else if (selectedModel.provider === 'lmstudio') {
      const modelId = selectedModel.model.replace(/^lmstudio\//, '');
      args.push('--model', `lmstudio/${modelId}`);
    } else if (selectedModel.provider === 'vertex') {
      // Model IDs stored as "vertex/{publisher}/{model}" — strip publisher for @ai-sdk/google-vertex
      const modelId = selectedModel.model.replace(/^vertex\/[^/]+\//, '');
      args.push('--model', `vertex/${modelId}`);
    } else if (selectedModel.provider === 'custom') {
      const modelId = selectedModel.model.replace(/^custom\//, '');
      args.push('--model', `custom/${modelId}`);
    } else {
      args.push('--model', selectedModel.model);
    }
  }

  if (sessionId) {
    args.push('--session', sessionId);
  }

  args.push('--agent', ACCOMPLISH_AGENT_NAME);

  args.push(prompt);

  return args;
}
