/**
 * Typed analytics event helpers — wraps trackEvent() with specific event names
 * and typed parameters. Ported from commercial, with enterprise-only code removed.
 *
 * All events no-op when analytics is disabled (no build.env → isAnalyticsEnabled() = false).
 */

import { nativeTheme } from 'electron';
import {
  trackEvent,
  incrementTaskCount,
  getSessionTaskCount,
  getSessionDuration,
  isFirstTaskCompleted,
  markFirstTaskCompleted,
  getFirstSeenAt,
} from './analytics-service';
import { getAllApiKeys } from '../store/secureStorage';
export type { TaskContext, TaskErrorCategory } from './types';
export { classifyErrorCategory } from './error-classifier';
import type { TaskContext, TaskErrorCategory } from './types';

// =============================================================================
// Shared Hardware Properties
// =============================================================================

export interface HardwareProperties {
  gpu_name?: string;
  gpu_architecture?: string;
  effective_vram_gb?: number;
  total_memory_gb?: number;
  unified_memory?: boolean;
  is_apple_silicon?: boolean;
  cpu_cores?: number;
  os_name?: string;
  system_name?: string;
  hardware_capability?: string; // 'low' | 'medium' | 'high'
  max_recommended_params_b?: number;
}

let cachedHardwareProps: HardwareProperties | null = null;

export function setHardwareProperties(props: HardwareProperties): void {
  cachedHardwareProps = props;
}

export function getHardwareProperties(): HardwareProperties | null {
  return cachedHardwareProps;
}

// =============================================================================
// App Lifecycle Events
// =============================================================================

/**
 * Track app launch — fires once per session, right after initAnalytics().
 * @param isFirstLaunch true if this is the very first app launch (clientId was just created)
 */
export async function trackAppLaunched(isFirstLaunch: boolean): Promise<void> {
  const firstSeen = getFirstSeenAt();
  const timeSinceInstallS = firstSeen
    ? Math.floor((Date.now() - new Date(firstSeen).getTime()) / 1000)
    : 0;
  const keys = await getAllApiKeys();
  const connectedCount = Object.values(keys).filter((v) => v !== null).length;
  trackEvent('app_launched', {
    event_category: 'app_lifecycle',
    launch_type: isFirstLaunch ? 'cold' : 'warm',
    time_since_install_s: timeSinceInstallS,
    connected_providers_count: connectedCount,
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  });
}

/**
 * Track app crash — best-effort, fires from uncaughtException / unhandledRejection handlers.
 * Rate-limited to MAX_CRASH_EVENTS per CRASH_WINDOW_MS to prevent hotshard flooding
 * from crash loops.
 */
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASH_EVENTS = 5;
let crashTimestamps: number[] = [];

/** @internal Visible for testing only */
export function _resetCrashRateLimit(): void {
  crashTimestamps = [];
}

export function trackAppCrash(errorType: string, errorMessage: string): void {
  const now = Date.now();

  // Evict timestamps outside the window
  while (crashTimestamps.length > 0 && now - crashTimestamps[0] >= CRASH_WINDOW_MS) {
    crashTimestamps.shift();
  }

  if (crashTimestamps.length >= MAX_CRASH_EVENTS) {
    return;
  }

  crashTimestamps.push(now);

  trackEvent('app_crash', {
    event_category: 'app_lifecycle',
    error_type: errorType,
    error_message: errorMessage.substring(0, 500),
  });
}

// =============================================================================
// Navigation Events
// =============================================================================

export function trackPageView(pagePath: string, pageTitle?: string): void {
  trackEvent('page_view', {
    page_path: pagePath,
    page_title: pageTitle,
    event_category: 'navigation',
  });
}

// =============================================================================
// Engagement Events
// =============================================================================

export function trackSubmitTask(model?: string, provider?: string): void {
  trackEvent('submit_task', {
    event_category: 'engagement',
    model,
    provider,
  });
}

export function trackNewTask(): void {
  trackEvent('new_task', {
    event_category: 'engagement',
  });
}

export function trackOpenSettings(): void {
  trackEvent('open_settings', {
    event_category: 'engagement',
  });
}

// =============================================================================
// Settings Events
// =============================================================================

export function trackSaveApiKey(
  provider: string,
  success: boolean,
  connectionMethod?: string,
): void {
  trackEvent('save_api_key', {
    event_category: 'settings',
    provider,
    success,
    ...(connectionMethod && { connection_method: connectionMethod }),
  });
}

export function trackSelectProvider(provider: string): void {
  trackEvent('select_provider', {
    event_category: 'settings',
    provider,
  });
}

export function trackSelectModel(model: string, provider?: string): void {
  trackEvent('select_model', {
    event_category: 'settings',
    model,
    provider,
  });
}

export function trackToggleDebugMode(enabled: boolean): void {
  trackEvent('toggle_debug_mode', {
    event_category: 'settings',
    enabled,
  });
}

// =============================================================================
// Update Events (helpers ported — call sites deferred until auto-updater integration)
// =============================================================================

export function trackUpdateCheck(): void {
  trackEvent('update_check', { event_category: 'updates' });
}

export function trackUpdateAvailable(currentVersion: string, newVersion: string): void {
  trackEvent('update_available', {
    event_category: 'updates',
    current_version: currentVersion,
    new_version: newVersion,
  });
}

export function trackUpdateNotAvailable(): void {
  trackEvent('update_not_available', { event_category: 'updates' });
}

export function trackUpdateDownloadStart(newVersion: string): void {
  trackEvent('update_download_start', { event_category: 'updates', new_version: newVersion });
}

export function trackUpdateDownloadComplete(newVersion: string): void {
  trackEvent('update_download_complete', { event_category: 'updates', new_version: newVersion });
}

export function trackUpdateInstallStart(newVersion: string): void {
  trackEvent('update_install_start', { event_category: 'updates', new_version: newVersion });
}

export function trackUpdateFailed(errorType: string, errorMessage: string): void {
  trackEvent('update_failed', {
    event_category: 'updates',
    error_type: errorType,
    error_message: errorMessage,
  });
}

// =============================================================================
// Task Lifecycle Events
// =============================================================================

export function trackTaskStart(context: TaskContext, model?: string, provider?: string): void {
  incrementTaskCount();
  trackEvent('task_start', {
    event_category: 'task_lifecycle',
    task_id: context.taskId,
    opencode_session_id: context.sessionId,
    task_type: context.taskType,
    model,
    provider,
  });
}

export function trackTaskComplete(
  context: TaskContext,
  durationMs: number,
  totalSteps: number,
  hadErrors: boolean,
  model?: string,
  totalTokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache_read: number;
    cache_write: number;
  },
  totalCost?: number,
  provider?: string,
): void {
  try {
    trackEvent('task_complete', {
      event_category: 'task_lifecycle',
      task_id: context.taskId,
      opencode_session_id: context.sessionId,
      task_type: context.taskType,
      duration_ms: durationMs,
      total_steps: totalSteps,
      had_errors: hadErrors,
      model,
      provider,
      tokens_input: totalTokens?.input,
      tokens_output: totalTokens?.output,
      tokens_reasoning: totalTokens?.reasoning,
      tokens_cache_read: totalTokens?.cache_read,
      tokens_cache_write: totalTokens?.cache_write,
      cost_usd: totalCost,
    });

    // Track first task completion (activation metric)
    if (!isFirstTaskCompleted()) {
      const firstSeen = getFirstSeenAt();
      const daysSinceInstall = firstSeen
        ? Math.floor((Date.now() - new Date(firstSeen).getTime()) / 86_400_000)
        : 0;
      trackEvent('first_task_complete', {
        event_category: 'activation',
        task_id: context.taskId,
        opencode_session_id: context.sessionId,
        task_type: context.taskType,
        days_since_install: daysSinceInstall,
        model,
        provider,
      });
      markFirstTaskCompleted();
    }
  } catch (error) {
    console.error('[Analytics] Failed to track task complete:', error);
  }
}

export function trackTaskCancel(
  context: TaskContext,
  durationMs: number,
  totalSteps: number,
  model?: string,
  totalTokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache_read: number;
    cache_write: number;
  },
  totalCost?: number,
  provider?: string,
): void {
  try {
    trackEvent('task_cancel', {
      event_category: 'task_lifecycle',
      task_id: context.taskId,
      opencode_session_id: context.sessionId,
      task_type: context.taskType,
      duration_ms: durationMs,
      total_steps: totalSteps,
      model,
      provider,
      tokens_input: totalTokens?.input,
      tokens_output: totalTokens?.output,
      tokens_reasoning: totalTokens?.reasoning,
      tokens_cache_read: totalTokens?.cache_read,
      tokens_cache_write: totalTokens?.cache_write,
      cost_usd: totalCost,
    });
  } catch (error) {
    console.error('[Analytics] Failed to track task cancel:', error);
  }
}

export function trackTaskError(
  context: TaskContext,
  durationMs: number,
  totalSteps: number,
  errorType: TaskErrorCategory,
  model?: string,
  totalTokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache_read: number;
    cache_write: number;
  },
  totalCost?: number,
  provider?: string,
  failureReason?: string,
): void {
  trackEvent('task_error', {
    event_category: 'task_lifecycle',
    task_id: context.taskId,
    opencode_session_id: context.sessionId,
    task_type: context.taskType,
    duration_ms: durationMs,
    total_steps: totalSteps,
    error_type: errorType,
    model,
    provider,
    tokens_input: totalTokens?.input,
    tokens_output: totalTokens?.output,
    tokens_reasoning: totalTokens?.reasoning,
    tokens_cache_read: totalTokens?.cache_read,
    tokens_cache_write: totalTokens?.cache_write,
    cost_usd: totalCost,
    failure_reason: failureReason ? failureReason.slice(0, 500) : undefined,
  });
}

export function trackPermissionRequested(
  context: TaskContext,
  permissionType: string,
  model?: string,
  provider?: string,
): void {
  trackEvent('permission_requested', {
    event_category: 'task_lifecycle',
    task_id: context.taskId,
    opencode_session_id: context.sessionId,
    task_type: context.taskType,
    permission_type: permissionType,
    model,
    provider,
  });
}

export function trackPermissionResponse(
  context: TaskContext,
  permissionType: string,
  granted: boolean,
  model?: string,
  provider?: string,
): void {
  trackEvent('permission_response', {
    event_category: 'task_lifecycle',
    task_id: context.taskId,
    opencode_session_id: context.sessionId,
    task_type: context.taskType,
    permission_type: permissionType,
    granted,
    model,
    provider,
  });
}

export function trackToolUsed(
  context: TaskContext,
  toolName: string,
  model?: string,
  provider?: string,
): void {
  trackEvent('tool_used', {
    event_category: 'task_lifecycle',
    task_id: context.taskId,
    opencode_session_id: context.sessionId,
    task_type: context.taskType,
    tool_name: toolName,
    model,
    provider,
  });
}

export function trackUserInteraction(
  context: TaskContext,
  interactionType: string,
  usedSuggestion: boolean,
  model?: string,
  provider?: string,
): void {
  trackEvent('user_interaction', {
    event_category: 'task_lifecycle',
    task_id: context.taskId,
    opencode_session_id: context.sessionId,
    task_type: context.taskType,
    interaction_type: interactionType,
    used_suggestion: usedSuggestion,
    model,
    provider,
  });
}

// =============================================================================
// Session Events
// =============================================================================

export async function trackAppClose(): Promise<void> {
  const keys = await getAllApiKeys();
  const connectedCount = Object.values(keys).filter((v) => v !== null).length;
  trackEvent('app_close', {
    event_category: 'session',
    duration_seconds: getSessionDuration(),
    task_count: getSessionTaskCount(),
    connected_providers_count: connectedCount,
  });
}

export function trackAppBackgrounded(): void {
  trackEvent('app_backgrounded', { event_category: 'session' });
}

export function trackAppForegrounded(): void {
  trackEvent('app_foregrounded', { event_category: 'session' });
}

// =============================================================================
// Model Selection Events
// =============================================================================

export function trackModelSelectionStep(
  step: string,
  isOnboarding: boolean,
  provider?: string,
  model?: string,
): void {
  trackEvent('model_selection_step', {
    event_category: 'model_selection',
    step,
    is_onboarding: isOnboarding,
    provider,
    model,
  });
}

export function trackModelSelectionComplete(
  provider: string,
  isOnboarding: boolean,
  model?: string,
): void {
  trackEvent('model_selection_complete', {
    event_category: 'model_selection',
    provider,
    is_onboarding: isOnboarding,
    model,
  });
}

export function trackModelSelectionAbandoned(lastStep: string, isOnboarding: boolean): void {
  trackEvent('model_selection_abandoned', {
    event_category: 'model_selection',
    last_step: lastStep,
    is_onboarding: isOnboarding,
  });
}

// =============================================================================
// Feature Usage Events
// =============================================================================

export function trackHistoryViewed(): void {
  trackEvent('history_viewed', { event_category: 'feature_usage' });
}

export function trackTaskFromHistory(): void {
  trackEvent('task_from_history', { event_category: 'feature_usage' });
}

export function trackHistoryCleared(): void {
  trackEvent('history_cleared', { event_category: 'feature_usage' });
}

export function trackTaskDetailsExpanded(): void {
  trackEvent('task_details_expanded', { event_category: 'feature_usage' });
}

export function trackOutputCopied(): void {
  trackEvent('output_copied', { event_category: 'feature_usage' });
}

// =============================================================================
// Provider Lifecycle Events
// =============================================================================

export function trackProviderDisconnected(provider: string): void {
  trackEvent('provider_disconnected', { event_category: 'settings', provider });
}

export function trackHelpLinkClicked(provider: string): void {
  trackEvent('help_link_clicked', { event_category: 'settings', provider });
}

export function trackContextSizeChanged(
  params: {
    old_value: number | null;
    new_value: number | null;
    provider: string;
    model_id?: string;
  } & Partial<HardwareProperties>,
): void {
  const { old_value, new_value, ...rest } = params;
  trackEvent('context_size_changed', {
    event_category: 'settings',
    old_value: old_value ?? undefined,
    new_value: new_value ?? undefined,
    ...rest,
  });
}

// =============================================================================
// Skills Events
// =============================================================================

export function trackSkillAction(params: {
  action: string;
  skill_name?: string;
  enabled?: boolean;
  filter?: string;
  source?: string;
}): void {
  trackEvent('skill_action', { event_category: 'feature_usage', ...params });
}

// =============================================================================
// Voice Events
// =============================================================================

export function trackSaveVoiceApiKey(success: boolean): void {
  trackEvent('save_voice_api_key', { event_category: 'settings', success });
}

// =============================================================================
// Debug Events
// =============================================================================

export function trackExportLogs(): void {
  trackEvent('export_logs', { event_category: 'feature_usage' });
}

export function trackThreadExported(): void {
  trackEvent('thread_exported', { event_category: 'feature_usage' });
}

// =============================================================================
// Task Launcher Events
// =============================================================================

export function trackTaskLauncherAction(action: string): void {
  trackEvent('task_launcher_action', { event_category: 'feature_usage', action });
}

// =============================================================================
// Latency Events
// =============================================================================

/**
 * Track time-to-first-response for a task — the wall-clock time from
 * task:start to the first assistant text arriving.
 */
export function trackTaskFirstResponse(
  taskId: string,
  durationMs: number,
  usedPrewarm: boolean,
  taskSessionState: 'cold' | 'warm',
  model?: string,
  provider?: string,
): void {
  trackEvent('task_first_response', {
    event_category: 'task_lifecycle',
    task_id: taskId,
    duration_ms: Math.round(durationMs),
    used_prewarm: usedPrewarm,
    task_session_state: taskSessionState,
    model,
    provider,
  });
}

// =============================================================================
// Task Feedback Events
// =============================================================================

export function trackTaskFeedback(
  taskId: string,
  sessionId: string,
  rating: string,
  taskStatus: string,
  feedbackStage: string,
  model?: string,
  provider?: string,
  feedbackReason?: string,
  feedbackText?: string,
): void {
  trackEvent('task_feedback', {
    event_category: 'task_lifecycle',
    task_id: taskId,
    opencode_session_id: sessionId,
    rating,
    task_status: taskStatus,
    feedback_stage: feedbackStage,
    model,
    provider,
    feedback_reason: feedbackReason,
    feedback_text: feedbackText?.substring(0, 500),
  });
}

// =============================================================================
// Agent Control Events
// =============================================================================

export function trackStopAgent(taskId: string, sessionId: string): void {
  trackEvent('stop_agent', {
    event_category: 'task_lifecycle',
    task_id: taskId,
    opencode_session_id: sessionId,
  });
}

// =============================================================================
// Provider Box Click Events
// =============================================================================

export function trackProviderBoxClicked(params: {
  provider_id: string;
  is_connected: boolean;
  is_onboarding: boolean;
}): void {
  trackEvent('provider_box_clicked', { event_category: 'model_selection', ...params });
}
