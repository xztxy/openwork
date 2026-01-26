import type { OpenCodeMessage, OpenCodeToolUseMessage } from '@accomplish/shared';

interface BufferedMessage {
  role: 'assistant' | 'tool';
  content: string;
  timestamp: string;
}

/**
 * Collects and formats agent messages for evaluator input.
 * Keeps a sliding window of the most recent messages.
 */
export class ConversationBuffer {
  private messages: BufferedMessage[] = [];
  private maxMessages: number;

  constructor(maxMessages = 30) {
    this.maxMessages = maxMessages;
  }

  /**
   * Add a message from the StreamParser.
   * Filters to only text and tool_use messages (the evaluator doesn't need step_start/step_finish).
   */
  addMessage(msg: OpenCodeMessage): void {
    if (msg.type === 'text' && msg.part.text) {
      this.messages.push({
        role: 'assistant',
        content: msg.part.text,
        timestamp: String(msg.timestamp || new Date().toISOString()),
      });
    } else if (msg.type === 'tool_use') {
      const toolMsg = msg as OpenCodeToolUseMessage;
      const toolName = toolMsg.part.tool || 'unknown';
      const status = toolMsg.part.state?.status || 'unknown';
      const output = toolMsg.part.state?.output || '';
      const truncatedOutput = output.length > 500
        ? output.substring(0, 500) + '...[truncated]'
        : output;
      this.messages.push({
        role: 'tool',
        content: `[Tool: ${toolName}] Status: ${status}${truncatedOutput ? `\nOutput: ${truncatedOutput}` : ''}`,
        timestamp: String(msg.timestamp || new Date().toISOString()),
      });
    } else if (msg.type === 'tool_call') {
      const toolName = msg.part.tool || 'unknown';
      this.messages.push({
        role: 'tool',
        content: `[Tool call: ${toolName}]`,
        timestamp: String(msg.timestamp || new Date().toISOString()),
      });
    }

    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  formatForEvaluation(): string {
    if (this.messages.length === 0) {
      return '[No messages recorded]';
    }

    return this.messages
      .map((m) => {
        const prefix = m.role === 'assistant' ? 'ASSISTANT' : 'TOOL';
        return `[${prefix}] ${m.content}`;
      })
      .join('\n\n');
  }

  get length(): number {
    return this.messages.length;
  }

  reset(): void {
    this.messages = [];
  }
}
