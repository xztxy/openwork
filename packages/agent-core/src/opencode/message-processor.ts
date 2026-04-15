import type { OpenCodeMessage, OpenCodeToolUseMessage } from '../common/types/opencode.js';
import type { TaskMessage } from '../common/types/task.js';
import { createMessageId } from '../common/index.js';
import { extractScreenshots } from './message-attachments.js';
import {
  sanitizeAssistantTextForDisplay,
  sanitizeToolOutput,
  getToolDisplayName,
} from './message-sanitization.js';

export type { MessageAttachment } from './message-attachments.js';
export { MESSAGE_BATCH_DELAY_MS } from './message-batcher.js';
export type { MessageBatcher } from './message-batcher.js';
export { createMessageBatcher, queueMessage, flushAndCleanupBatcher } from './message-batcher.js';
export {
  sanitizeAssistantTextForDisplay,
  sanitizeToolOutput,
  getToolDisplayName,
} from './message-sanitization.js';
export { extractScreenshots } from './message-attachments.js';

const MAX_TOOL_OUTPUT_LENGTH = 200_000;

/**
 * Per-message model/provider context passed through by the SDK adapter.
 * The adapter knows which model produced each message and annotates the
 * `TaskMessage` so the UI can attribute tool/assistant output to a specific
 * model without needing a separate lookup.
 *
 * Added by the OpenCode SDK cutover port (commercial PR #720).
 */
export interface ModelContext {
  modelId?: string;
  providerId?: string;
}

/**
 * Build a stable `TaskMessage.id` for a text message from the SDK's
 * session + message identifiers. Using `${sessionID}:${messageID}` means the
 * renderer's `upsertTaskMessages` collapses consecutive `message.updated`
 * events (with the same text part) into one row instead of appending
 * duplicates.
 *
 * Added by commercial PR #720. Consumed by the SDK-based adapter (Phase 1b).
 */
function getStableTextMessageId(message: OpenCodeMessage & { type: 'text' }): string {
  return `${message.part.sessionID}:${message.part.messageID}`;
}

/**
 * Build a stable `TaskMessage.id` for a tool-use message from the SDK's
 * session + part identifiers. Critical for tool-row state transitions —
 * the same part ID is emitted for `running` → `completed`/`error`, so the
 * UI coalesces the row in place and updates `toolStatus` rather than
 * appending a new row per state change.
 *
 * Added by commercial PR #720. Consumed by the SDK-based adapter (Phase 1b).
 */
function getStableToolUseMessageId(message: OpenCodeToolUseMessage): string {
  return `${message.part.sessionID}:${message.part.id}`;
}

/**
 * Phase 1c of the OpenCode SDK cutover port extracted `mergeTaskMessage`
 * into `common/utils/task-message-merge.ts` so the renderer's browser-safe
 * entry can share the exact same semantics as the daemon-side batcher.
 * Re-exported here so existing daemon-side callers keep working.
 */
export { mergeTaskMessage } from '../common/utils/task-message-merge.js';

function getTaskMessageTimestamp(message: OpenCodeMessage): string {
  return new Date(message.timestamp ?? Date.now()).toISOString();
}

/**
 * Converts an OpenCodeMessage to a TaskMessage for display in the UI.
 * Returns null if the message should not be displayed.
 *
 * Behaviour changes introduced by the OpenCode SDK cutover port (PR #720):
 *   - Stable part IDs for text and tool_use messages (coalescing).
 *   - Tool-use 'running' state is now emitted (OSS previously dropped it).
 *   - Optional `ModelContext` stamps `modelId`/`providerId` on each message.
 *   - Timestamps derive from the SDK message, not `new Date()` at call time.
 *
 * The `modelContext` parameter is optional for back-compat with callers that
 * don't yet pass it (legacy PTY adapter). The SDK-based adapter in Phase 1b
 * will always pass it.
 */
export function toTaskMessage(
  message: OpenCodeMessage,
  modelContext?: ModelContext,
): TaskMessage | null {
  if (message.type === 'text') {
    const sanitized = sanitizeAssistantTextForDisplay(message.part.text || '');
    if (sanitized) {
      return {
        id: getStableTextMessageId(message),
        type: 'assistant',
        content: sanitized,
        timestamp: getTaskMessageTimestamp(message),
        ...(modelContext?.modelId && { modelId: modelContext.modelId }),
        ...(modelContext?.providerId && { providerId: modelContext.providerId }),
      };
    }
    return null;
  }

  if (message.type === 'tool_call') {
    const displayName = getToolDisplayName(message.part.tool);
    if (displayName === null) {
      return null;
    }
    return {
      id: createMessageId(),
      type: 'tool',
      content: `Using tool: ${displayName}`,
      toolName: message.part.tool,
      toolInput: message.part.input,
      timestamp: getTaskMessageTimestamp(message),
      ...(modelContext?.modelId && { modelId: modelContext.modelId }),
      ...(modelContext?.providerId && { providerId: modelContext.providerId }),
    };
  }

  if (message.type === 'tool_use') {
    const toolUseMsg = message as OpenCodeToolUseMessage;
    const toolName = toolUseMsg.part.tool || 'unknown';
    const displayName = getToolDisplayName(toolName);
    if (displayName === null) {
      return null;
    }
    const toolInput = toolUseMsg.part.state?.input;
    const toolOutput = toolUseMsg.part.state?.output || '';
    const status = toolUseMsg.part.state?.status;

    if (status === 'running' || status === 'completed' || status === 'error') {
      const wasTruncated = toolOutput.length > MAX_TOOL_OUTPUT_LENGTH;
      const stableOutput = wasTruncated
        ? `${toolOutput.slice(0, MAX_TOOL_OUTPUT_LENGTH)}\n[Tool output truncated]`
        : toolOutput;
      // On 'running' state there's no final output yet — skip screenshot extraction
      // and leave content empty; the 'completed'/'error' update for the same part ID
      // will supply it.
      const { cleanedText, attachments } =
        status === 'running'
          ? { cleanedText: '', attachments: [] as never[] }
          : extractScreenshots(stableOutput);
      const isError = status === 'error';
      const sanitizedText = sanitizeToolOutput(cleanedText, isError);
      const displayText =
        sanitizedText.length > 500 ? sanitizedText.substring(0, 500) + '...' : sanitizedText;

      return {
        id: getStableToolUseMessageId(toolUseMsg),
        type: 'tool',
        content: displayText || `Tool ${toolName} ${status}`,
        toolName,
        toolStatus: status,
        toolInput,
        timestamp: getTaskMessageTimestamp(message),
        attachments: !wasTruncated && attachments.length > 0 ? attachments : undefined,
        ...(modelContext?.modelId && { modelId: modelContext.modelId }),
        ...(modelContext?.providerId && { providerId: modelContext.providerId }),
      };
    }
    return null;
  }

  return null;
}
