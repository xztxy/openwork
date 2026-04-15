// Phase 4b of the OpenCode SDK cutover port simplified this barrel: the
// PTY-era TaskManager wiring (`createElectronTaskManagerOptions`,
// `buildCliArgs`, `getCliCommand`, `isCliAvailable`, `onBeforeStart`,
// `onBeforeTaskStart`, `buildEnvironment`) is gone — task execution is
// owned by `apps/daemon`. The desktop only retains:
//   - bundled OpenCode CLI metadata for the Settings UI
//   - dev-browser MCP server shutdown for app teardown
//   - Vertex service-account key cleanup
//   - `loginOpenAiWithChatGpt` was removed in Phase 4a (now a daemon RPC).

// Re-export agent-core types still used by callers in the main process.
export type {
  TaskManagerOptions,
  TaskCallbacks,
  TaskProgressEvent,
  TaskManagerAPI,
} from '@accomplish_ai/agent-core';
export { OpenCodeCliNotFoundError } from '@accomplish_ai/agent-core';

export { cleanupVertexServiceAccountKey } from './vertex-cleanup';
export { stopDevBrowserServer } from './dev-browser-shutdown';
export {
  getOpenCodeCliPath,
  isOpenCodeCliAvailable,
  getBundledOpenCodeVersion,
} from './cli-resolver';

import { isOpenCodeCliAvailable, getBundledOpenCodeVersion } from './cli-resolver';

export async function isOpenCodeCliInstalled(): Promise<boolean> {
  return isOpenCodeCliAvailable();
}

export async function getOpenCodeCliVersion(): Promise<string | null> {
  return getBundledOpenCodeVersion();
}
