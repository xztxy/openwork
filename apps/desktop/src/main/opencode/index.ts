// Factory functions from agent-core
export { OpenCodeCliNotFoundError, createTaskManager } from '@accomplish_ai/agent-core';

// Types from agent-core
export type {
  TaskManagerOptions,
  TaskCallbacks,
  TaskProgressEvent,
  TaskManagerAPI,
} from '@accomplish_ai/agent-core';

export {
  createElectronTaskManagerOptions,
  buildEnvironment,
  buildCliArgs,
  getCliCommand,
  isCliAvailable,
  onBeforeStart,
  onBeforeTaskStart,
  getOpenCodeCliPath,
  getBundledOpenCodeVersion,
  cleanupVertexServiceAccountKey,
  recoverDevBrowserServer,
  stopDevBrowserServer,
} from './electron-options';

export {
  generateOpenCodeConfig,
  getMcpToolsPath,
  syncApiKeysToOpenCodeAuth,
  ACCOMPLISH_AGENT_NAME,
} from './config-generator';

// `loginOpenAiWithChatGpt` export removed in Phase 4a of the SDK cutover port.
// The IPC handler for `opencode:auth:openai:login` now delegates directly to
// the daemon's `auth.openai.{startLogin, awaitCompletion}` RPCs — see
// `apps/desktop/src/main/ipc/handlers/settings-handlers/auth-handlers.ts`.

import { isCliAvailable, getBundledOpenCodeVersion } from './electron-options';

export async function isOpenCodeCliInstalled(): Promise<boolean> {
  return isCliAvailable();
}

export async function getOpenCodeCliVersion(): Promise<string | null> {
  return getBundledOpenCodeVersion();
}
