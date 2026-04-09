import type { TaskErrorCategory } from './types';

/**
 * Classify a raw error name/message into a standardized TaskErrorCategory.
 * Maps log-watcher error names and common Error.name values.
 */
export function classifyErrorCategory(errorName: unknown): TaskErrorCategory {
  const name = String(errorName).toLowerCase();

  // Auth errors
  if (
    name.includes('auth') ||
    name.includes('oauth') ||
    name.includes('unauthorized') ||
    name.includes('accessdenied') ||
    name.includes('invalidsignature')
  ) {
    return 'auth_error';
  }

  // Rate limiting
  if (
    name.includes('throttl') ||
    name.includes('rate_limit') ||
    name.includes('ratelimit') ||
    name.includes('429')
  ) {
    return 'rate_limit';
  }

  // Timeouts
  if (name.includes('timeout') || name === 'aborterror') {
    return 'timeout';
  }

  // Network errors
  if (
    name.includes('network') ||
    name.includes('econnrefused') ||
    name.includes('enotfound') ||
    name.includes('503')
  ) {
    return 'network_error';
  }

  // Context overflow (local model context window too small)
  if (
    name.includes('contextoverflowerror') ||
    name.includes('n_keep') ||
    name.includes('n_ctx') ||
    name.includes('context window is too small') ||
    name.includes('context size has been exceeded') ||
    name.includes('exceeds the available context size')
  ) {
    return 'context_overflow';
  }

  // User interruptions
  if (name.includes('interrupt') || name.includes('cancel') || name.includes('abort')) {
    return 'user_interrupted';
  }

  // Tool errors
  if (name.includes('tool_error') || name.includes('validation')) {
    return 'tool_error';
  }

  return 'unknown';
}
