/**
 * Analytics IPC handlers — bridges renderer analytics calls to main process event helpers.
 *
 * The renderer calls window.accomplish.analytics.trackXxx(...) which invokes
 * ipcRenderer.invoke('analytics:xxx', ...) → handled here → calls event helpers.
 */

import type { IpcMainInvokeEvent } from 'electron';
import { handle } from './utils';
import { getStorage } from '../../store/storage';
import { isAnalyticsEnabled } from '../../config/build-config';
import type { TaskErrorCategory } from '../../analytics/types';
import {
  trackEvent,
  trackAppClose,
  trackAppBackgrounded,
  trackAppForegrounded,
  trackPageView,
  trackSubmitTask,
  trackNewTask,
  trackOpenSettings,
  trackSaveApiKey,
  trackSelectProvider,
  trackSelectModel,
  trackToggleDebugMode,
  trackTaskStart,
  trackTaskComplete,
  trackTaskError,
  trackPermissionRequested,
  trackPermissionResponse,
  trackToolUsed,
  trackUserInteraction,
  trackModelSelectionStep,
  trackModelSelectionComplete,
  trackModelSelectionAbandoned,
  trackHistoryViewed,
  trackTaskFromHistory,
  trackHistoryCleared,
  trackTaskDetailsExpanded,
  trackOutputCopied,
  trackProviderDisconnected,
  trackHelpLinkClicked,
  trackSkillAction,
  trackSaveVoiceApiKey,
  trackExportLogs,
  trackThreadExported,
  trackTaskLauncherAction,
  trackTaskFeedback,
  trackStopAgent,
  trackProviderBoxClicked,
} from '../../analytics';

/**
 * Helper to look up the currently selected model + provider from storage.
 * Used by task lifecycle events to automatically include model context.
 * Returns empty object if storage doesn't support model/provider lookups.
 */
function getSelectedModelContext(): {
  model?: string;
  provider?: string;
} {
  try {
    const storage = getStorage();
    // The storage schema may not have dedicated model/provider getters.
    // Use the raw DB query if available, otherwise return empty.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (storage as any).db;
    if (!db) return {};
    const row = db
      .prepare?.(
        `SELECT provider_id, selected_model_id FROM provider_configs WHERE is_selected = 1 LIMIT 1`,
      )
      ?.get?.() as { provider_id?: string; selected_model_id?: string } | undefined;
    return {
      provider: row?.provider_id ?? undefined,
      model: row?.selected_model_id ?? undefined,
    };
  } catch {
    return {};
  }
}

export function registerAnalyticsHandlers(): void {
  // Skip registration entirely if analytics is not enabled (OSS builds)
  if (!isAnalyticsEnabled()) return;

  // Generic event tracking
  handle(
    'analytics:track',
    async (
      _event: IpcMainInvokeEvent,
      eventName: string,
      params?: Record<string, string | number | boolean>,
    ) => {
      trackEvent(eventName, params);
    },
  );

  // Navigation
  handle(
    'analytics:page-view',
    async (_event: IpcMainInvokeEvent, pagePath: string, pageTitle?: string) => {
      trackPageView(pagePath, pageTitle);
    },
  );

  // Engagement
  handle('analytics:submit-task', async () => {
    const { model, provider } = getSelectedModelContext();
    trackSubmitTask(model, provider);
  });

  handle('analytics:new-task', async () => {
    trackNewTask();
  });

  handle('analytics:open-settings', async () => {
    trackOpenSettings();
  });

  // Settings
  handle(
    'analytics:save-api-key',
    async (
      _event: IpcMainInvokeEvent,
      provider: string,
      success: boolean,
      connectionMethod?: string,
    ) => {
      trackSaveApiKey(provider, success, connectionMethod);
    },
  );

  handle('analytics:select-provider', async (_event: IpcMainInvokeEvent, provider: string) => {
    trackSelectProvider(provider);
  });

  handle(
    'analytics:select-model',
    async (_event: IpcMainInvokeEvent, model: string, provider?: string) => {
      trackSelectModel(model, provider);
    },
  );

  handle('analytics:toggle-debug-mode', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    trackToggleDebugMode(enabled);
  });

  // Task Lifecycle (from renderer — e.g., when renderer knows task state)
  handle(
    'analytics:task-start',
    async (_event: IpcMainInvokeEvent, taskId: string, sessionId: string, taskType: string) => {
      const { model, provider } = getSelectedModelContext();
      trackTaskStart({ taskId, sessionId, taskType }, model, provider);
    },
  );

  handle(
    'analytics:task-complete',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      taskType: string,
      durationMs: number,
      totalSteps: number,
      hadErrors: boolean,
    ) => {
      const { model, provider } = getSelectedModelContext();
      trackTaskComplete(
        { taskId, sessionId, taskType },
        durationMs,
        totalSteps,
        hadErrors,
        model,
        undefined,
        undefined,
        provider,
      );
    },
  );

  handle(
    'analytics:task-error',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      taskType: string,
      durationMs: number,
      totalSteps: number,
      errorType: string,
    ) => {
      const { model, provider } = getSelectedModelContext();
      trackTaskError(
        { taskId, sessionId, taskType },
        durationMs,
        totalSteps,
        errorType as TaskErrorCategory,
        model,
        undefined,
        undefined,
        provider,
      );
    },
  );

  handle(
    'analytics:permission-requested',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      taskType: string,
      permissionType: string,
    ) => {
      trackPermissionRequested({ taskId, sessionId, taskType }, permissionType);
    },
  );

  handle(
    'analytics:permission-response',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      taskType: string,
      permissionType: string,
      granted: boolean,
    ) => {
      trackPermissionResponse({ taskId, sessionId, taskType }, permissionType, granted);
    },
  );

  handle(
    'analytics:tool-used',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      taskType: string,
      toolName: string,
    ) => {
      trackToolUsed({ taskId, sessionId, taskType }, toolName);
    },
  );

  handle(
    'analytics:user-interaction',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      taskType: string,
      interactionType: string,
      usedSuggestion: boolean,
    ) => {
      trackUserInteraction({ taskId, sessionId, taskType }, interactionType, usedSuggestion);
    },
  );

  // Session
  handle('analytics:app-close', async () => {
    await trackAppClose();
  });

  handle('analytics:app-backgrounded', async () => {
    trackAppBackgrounded();
  });

  handle('analytics:app-foregrounded', async () => {
    trackAppForegrounded();
  });

  // Model Selection
  handle(
    'analytics:model-selection-step',
    async (
      _event: IpcMainInvokeEvent,
      step: string,
      isOnboarding: boolean,
      provider?: string,
      model?: string,
    ) => {
      trackModelSelectionStep(step, isOnboarding, provider, model);
    },
  );

  handle(
    'analytics:model-selection-complete',
    async (_event: IpcMainInvokeEvent, provider: string, isOnboarding: boolean, model?: string) => {
      trackModelSelectionComplete(provider, isOnboarding, model);
    },
  );

  handle(
    'analytics:model-selection-abandoned',
    async (_event: IpcMainInvokeEvent, lastStep: string, isOnboarding: boolean) => {
      trackModelSelectionAbandoned(lastStep, isOnboarding);
    },
  );

  // Feature Usage
  handle('analytics:history-viewed', async () => {
    trackHistoryViewed();
  });
  handle('analytics:task-from-history', async () => {
    trackTaskFromHistory();
  });
  handle('analytics:history-cleared', async () => {
    trackHistoryCleared();
  });
  handle('analytics:task-details-expanded', async () => {
    trackTaskDetailsExpanded();
  });
  handle('analytics:output-copied', async () => {
    trackOutputCopied();
  });

  // Provider Lifecycle
  handle(
    'analytics:provider-disconnected',
    async (_event: IpcMainInvokeEvent, provider: string) => {
      trackProviderDisconnected(provider);
    },
  );

  handle('analytics:help-link-clicked', async (_event: IpcMainInvokeEvent, provider: string) => {
    trackHelpLinkClicked(provider);
  });

  // Skills
  handle(
    'analytics:skill-action',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        action: string;
        skill_name?: string;
        enabled?: boolean;
        filter?: string;
        source?: string;
      },
    ) => {
      trackSkillAction(params);
    },
  );

  // Voice
  handle('analytics:save-voice-api-key', async (_event: IpcMainInvokeEvent, success: boolean) => {
    trackSaveVoiceApiKey(success);
  });

  // Debug
  handle('analytics:export-logs', async () => {
    trackExportLogs();
  });
  handle('analytics:thread-exported', async () => {
    trackThreadExported();
  });

  // Task Launcher
  handle('analytics:task-launcher-action', async (_event: IpcMainInvokeEvent, action: string) => {
    trackTaskLauncherAction(action);
  });

  // Task Feedback
  handle(
    'analytics:task-feedback',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string,
      sessionId: string,
      rating: string,
      taskStatus: string,
      feedbackStage: string,
      feedbackReason?: string,
      feedbackText?: string,
    ) => {
      trackTaskFeedback(
        taskId,
        sessionId,
        rating,
        taskStatus,
        feedbackStage,
        undefined,
        undefined,
        feedbackReason,
        feedbackText,
      );
    },
  );

  // Agent Control
  handle(
    'analytics:stop-agent',
    async (_event: IpcMainInvokeEvent, taskId: string, sessionId: string) => {
      trackStopAgent(taskId, sessionId);
    },
  );

  // Provider Box
  handle(
    'analytics:provider-box-clicked',
    async (
      _event: IpcMainInvokeEvent,
      params: { provider_id: string; is_connected: boolean; is_onboarding: boolean },
    ) => {
      trackProviderBoxClicked(params);
    },
  );
}
