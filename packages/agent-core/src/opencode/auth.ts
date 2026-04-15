import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createConsoleLogger } from '../utils/logging.js';
import type { OpenAiOauthPlan } from '../common/types/providerSettings.js';

const log = createConsoleLogger({ prefix: 'OpenCodeAuth' });

interface OpenCodeOauthAuthEntry {
  type?: string;
  refresh?: string;
  access?: string;
  expires?: number;
}

export function getOpenCodeDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

export function getOpenCodeAuthJsonPath(): string {
  return path.join(getOpenCodeDataHome(), 'opencode', 'auth.json');
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readOpenCodeAuthJson(): Record<string, unknown> | null {
  return readJsonFile(getOpenCodeAuthJsonPath());
}

export function getOpenAiOauthStatus(): { connected: boolean; expires?: number } {
  const authJson = readOpenCodeAuthJson();
  if (!authJson) return { connected: false };

  const entry = authJson.openai;
  if (!entry || typeof entry !== 'object') return { connected: false };

  const oauth = entry as OpenCodeOauthAuthEntry;
  if (oauth.type !== 'oauth') return { connected: false };

  const refresh = oauth.refresh;
  const connected = typeof refresh === 'string' && refresh.trim().length > 0;
  return { connected, expires: oauth.expires };
}

// -----------------------------------------------------------------------------
// OpenAI ChatGPT-OAuth plan detection
// -----------------------------------------------------------------------------
//
// Ported from commercial 1a320029:packages/agent-core/src/opencode/auth/openai.ts
// as part of the OpenCode SDK cutover port (Phase 4a). Consumed by the
// daemon's `auth.openai.awaitCompletion` RPC so the renderer can populate
// provider models from the free vs paid set once login completes.

export interface DetectOpenAiOauthPlanOptions {
  authStatePath?: string;
  timeoutMs?: number;
  pollMs?: number;
}

interface OpenAiAuthTokenPayload {
  'https://api.openai.com/auth'?: {
    chatgpt_plan_type?: string;
  };
}

const OPENAI_AUTH_PLAN_DETECTION_TIMEOUT_MS = 5_000;
const OPENAI_AUTH_PLAN_DETECTION_POLL_MS = 100;

function decodeJwtPayload(token: string): OpenAiAuthTokenPayload {
  const [, payloadSegment] = token.split('.');
  if (!payloadSegment) {
    throw new Error('OpenAI auth token is missing a JWT payload segment.');
  }

  const paddingLength = (4 - (payloadSegment.length % 4)) % 4;
  const normalizedPayload = `${payloadSegment.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat(
    paddingLength,
  )}`;

  return JSON.parse(Buffer.from(normalizedPayload, 'base64').toString('utf-8'));
}

/**
 * Read the ChatGPT plan from the OpenCode-persisted OAuth state file.
 * Throws when the file is missing the OpenAI entry, when the JWT payload is
 * malformed, or when the token does not include a `chatgpt_plan_type`
 * claim. Callers that want polling behaviour should use `detectOpenAiOauthPlan`.
 */
export function readOpenAiOauthPlan(authStatePath = getOpenCodeAuthJsonPath()): OpenAiOauthPlan {
  const authState = JSON.parse(fs.readFileSync(authStatePath, 'utf-8')) as {
    openai?: { access?: string };
  };
  const accessToken = authState.openai?.access;
  if (!accessToken) {
    throw new Error('OpenCode auth state does not include an OpenAI access token yet.');
  }

  const payload = decodeJwtPayload(accessToken);
  const planType = payload['https://api.openai.com/auth']?.chatgpt_plan_type?.trim().toLowerCase();
  if (!planType) {
    throw new Error('OpenCode auth token does not include chatgpt_plan_type.');
  }

  return planType === 'free' ? 'free' : 'paid';
}

/**
 * Poll the OAuth state file until the plan is readable or `timeoutMs` is
 * exceeded. Used immediately after the SDK OAuth flow completes — the auth
 * file is written asynchronously, so a brief poll window covers the gap
 * between "flow reports success" and "plan extractable".
 */
export async function detectOpenAiOauthPlan(
  options: DetectOpenAiOauthPlanOptions = {},
): Promise<OpenAiOauthPlan> {
  const authStatePath = options.authStatePath ?? getOpenCodeAuthJsonPath();
  const timeoutMs = options.timeoutMs ?? OPENAI_AUTH_PLAN_DETECTION_TIMEOUT_MS;
  const pollMs = options.pollMs ?? OPENAI_AUTH_PLAN_DETECTION_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() <= deadline) {
    try {
      return readOpenAiOauthPlan(authStatePath);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown OpenAI auth-state error');
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  throw new Error('Timed out waiting for OpenCode auth state to include an OpenAI plan.', {
    cause: lastError,
  });
}

export function getOpenAiOauthAccessToken(): string | null {
  const authJson = readOpenCodeAuthJson();
  if (!authJson) return null;

  const entry = authJson.openai;
  if (!entry || typeof entry !== 'object') return null;

  const oauth = entry as OpenCodeOauthAuthEntry;
  if (oauth.type !== 'oauth') return null;

  const access = oauth.access;
  return typeof access === 'string' && access.trim().length > 0 ? access : null;
}

/**
 * Phase 4b of the OpenCode SDK cutover port collapsed `getOpenCodeAuthPath`
 * to delegate to the XDG-aware `getOpenCodeAuthJsonPath`. Earlier callers
 * had two inconsistent helpers — the non-XDG version computed a hardcoded
 * `~/.local/share` (or `AppData\Local`) path that diverged from where
 * `opencode serve` actually writes when `XDG_DATA_HOME` is set. Unifying
 * everyone on a single helper means desktop status reads, daemon
 * `task-config-builder` writes, and the `auth.openai.{status,getAccessToken}`
 * RPC all resolve byte-identical paths.
 */
export function getOpenCodeAuthPath(): string {
  return getOpenCodeAuthJsonPath();
}

export function writeOpenCodeAuth(
  providerKeys: Record<string, { type: string; key: string }>,
): void {
  const authPath = getOpenCodeAuthPath();
  const authDir = path.dirname(authPath);

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  let auth: Record<string, { type: string; key: string }> = {};
  if (fs.existsSync(authPath)) {
    try {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    } catch (_e) {
      log.warn('[OpenCode Auth] Failed to parse existing auth.json, creating new one');
      auth = {};
    }
  }

  for (const [providerId, entry] of Object.entries(providerKeys)) {
    auth[providerId] = entry;
  }

  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
  log.info(`[OpenCode Auth] Updated auth.json at: ${authPath}`);
}

// Slack MCP OAuth helpers — re-exported from auth-slack-mcp.ts
export type { OpenCodeMcpOauthStatus } from './auth-slack-mcp.js';
export {
  OPENCODE_SLACK_MCP_SERVER_URL,
  OPENCODE_SLACK_MCP_CLIENT_ID,
  OPENCODE_SLACK_MCP_CALLBACK_HOST,
  OPENCODE_SLACK_MCP_CALLBACK_PORT,
  OPENCODE_SLACK_MCP_CALLBACK_PATH,
  getSlackMcpCallbackUrl,
  getOpenCodeMcpAuthJsonPath,
  getSlackMcpOauthStatus,
  setSlackMcpPendingAuth,
  setSlackMcpTokens,
  clearSlackMcpAuth,
} from './auth-slack-mcp.js';
