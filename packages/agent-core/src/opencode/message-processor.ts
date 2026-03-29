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
 * Converts an OpenCodeMessage to a TaskMessage for display in the UI.
 * Returns null if the message should not be displayed.
 */
export function toTaskMessage(message: OpenCodeMessage): TaskMessage | null {
  if (message.type === 'text') {
    const sanitized = sanitizeAssistantTextForDisplay(message.part.text || '');
    if (sanitized) {
      return {
        id: createMessageId(),
        type: 'assistant',
        content: sanitized,
        timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
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

    if (status === 'completed' || status === 'error') {
      const wasTruncated = toolOutput.length > MAX_TOOL_OUTPUT_LENGTH;
      const stableOutput = wasTruncated
        ? `${toolOutput.slice(0, MAX_TOOL_OUTPUT_LENGTH)}\n[Tool output truncated]`
        : toolOutput;
      const { cleanedText, attachments } = extractScreenshots(stableOutput);
      const isError = status === 'error';
      const sanitizedText = sanitizeToolOutput(cleanedText, isError);
      const displayText =
        sanitizedText.length > 500 ? sanitizedText.substring(0, 500) + '...' : sanitizedText;

      return {
        id: createMessageId(),
        type: 'tool',
        content: displayText || `Tool ${toolName} ${status}`,
        toolName,
        toolInput,
        timestamp: new Date().toISOString(),
        attachments: !wasTruncated && attachments.length > 0 ? attachments : undefined,
      };
    }
    return null;
  }

  return null;
}
