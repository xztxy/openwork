/**
 * Analytics barrel — re-exports all analytics modules.
 *
 * Usage: import { trackAppLaunched, initAnalytics, ... } from './analytics';
 */

// Event helpers (typed wrappers around trackEvent)
export * from './events';

// Types
export type { TaskContext, TaskErrorCategory } from './types';

// Error classifier
export { classifyErrorCategory } from './error-classifier';

// Low-level services (from Phase 1)
export {
  initAnalytics,
  trackEvent,
  flushAnalytics,
  setOnlineStatus,
  getClientId,
  getDeviceFingerprint,
  getAnalyticsSessionId,
  getFirstSeenAt,
  getFirstLaunchVersion,
  isFirstTaskCompleted,
  markFirstTaskCompleted,
  incrementTaskCount,
  getSessionTaskCount,
  getSessionDuration,
} from './analytics-service';

export { initMixpanel, flushMixpanel } from './mixpanel-service';
