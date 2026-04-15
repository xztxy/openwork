import { describe, it, expect } from 'vitest';
import {
  sanitizeAssistantTextForDisplay,
  sanitizeToolOutput,
  toTaskMessage,
  getToolDisplayName,
  extractScreenshots,
  mergeTaskMessage,
} from '../../../src/opencode/message-processor.js';
import type { OpenCodeMessage } from '../../../src/common/types/opencode.js';
import type { TaskMessage } from '../../../src/common/types/task.js';

describe('sanitizeAssistantTextForDisplay', () => {
  it('preserves plain assistant text unchanged', () => {
    expect(sanitizeAssistantTextForDisplay('Hello, I can help you with that.')).toBe(
      'Hello, I can help you with that.',
    );
  });

  it('returns null for pure nudge block', () => {
    expect(sanitizeAssistantTextForDisplay('<nudge>some internal nudge</nudge>')).toBeNull();
  });

  it('returns null for pure instruction block', () => {
    const text =
      '<instruction name=context_management_protocol policy_level=critical>internal stuff</instruction>';
    expect(sanitizeAssistantTextForDisplay(text)).toBeNull();
  });

  it('returns null for pure thought block', () => {
    expect(sanitizeAssistantTextForDisplay('<thought>thinking...</thought>')).toBeNull();
  });

  it('returns null for pure scratchpad block', () => {
    expect(sanitizeAssistantTextForDisplay('<scratchpad>notes here</scratchpad>')).toBeNull();
  });

  it('returns null for pure thinking block', () => {
    expect(sanitizeAssistantTextForDisplay('<thinking>deep thought</thinking>')).toBeNull();
  });

  it('returns null for pure reflection block', () => {
    expect(sanitizeAssistantTextForDisplay('<reflection>self-review</reflection>')).toBeNull();
  });

  it('keeps user-facing text and strips thought block from mixed message', () => {
    const text = 'Here is your answer.\n<thought>internal reasoning</thought>';
    expect(sanitizeAssistantTextForDisplay(text)).toBe('Here is your answer.');
  });

  it('preserves non-internal XML like <div>', () => {
    expect(sanitizeAssistantTextForDisplay('<div>hello</div>')).toBe('<div>hello</div>');
  });

  it('does not match tags that merely start with internal tag names', () => {
    expect(sanitizeAssistantTextForDisplay('<thoughtful>hello</thoughtful>')).toBe(
      '<thoughtful>hello</thoughtful>',
    );
  });

  it('strips orphan closing tags', () => {
    const text = 'Some text</thought> more text';
    expect(sanitizeAssistantTextForDisplay(text)).toBe('Some text more text');
  });

  it('strips lines containing context_management_protocol', () => {
    const text = 'Good line\ncontext_management_protocol: do stuff\nAnother good line';
    expect(sanitizeAssistantTextForDisplay(text)).toBe('Good line\n\nAnother good line');
  });

  it('strips everything from lone opening <thought> tag to end (streaming edge)', () => {
    const text = 'Visible text\n<thought>partial thinking with no close';
    const result = sanitizeAssistantTextForDisplay(text);
    expect(result).toBe('Visible text');
  });
});

describe('toTaskMessage', () => {
  it('returns null for fully internal text', () => {
    const message: OpenCodeMessage = {
      type: 'text',
      part: {
        id: '1',
        sessionID: 's1',
        messageID: 'm1',
        type: 'text',
        text: '<thought>all internal</thought>',
      },
    };
    expect(toTaskMessage(message)).toBeNull();
  });

  it('returns valid TaskMessage with sanitized content for mixed text', () => {
    const message: OpenCodeMessage = {
      type: 'text',
      part: {
        id: '2',
        sessionID: 's1',
        messageID: 'm2',
        type: 'text',
        text: 'Hello user\n<nudge>internal</nudge>',
      },
    };
    const result = toTaskMessage(message);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.content).toBe('Hello user');
  });

  it('returns null for hidden tool names like discard', () => {
    const message: OpenCodeMessage = {
      type: 'tool_call',
      part: {
        id: '3',
        sessionID: 's1',
        messageID: 'm3',
        type: 'tool_call',
        tool: 'discard',
        input: '{}',
      },
    };
    expect(toTaskMessage(message)).toBeNull();
  });

  it('returns null for hidden tool names in tool_use path', () => {
    const message: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: '4',
        sessionID: 's1',
        messageID: 'm4',
        type: 'tool_use',
        tool: 'extract',
        state: { status: 'completed', output: 'some output' },
      },
    } as OpenCodeMessage;
    expect(toTaskMessage(message)).toBeNull();
  });

  it('stores raw tool ID in toolName, not display label', () => {
    const message: OpenCodeMessage = {
      type: 'tool_call',
      part: {
        id: '5',
        sessionID: 's1',
        messageID: 'm5',
        type: 'tool_call',
        tool: 'browser_click',
        input: '{}',
      },
    };
    const result = toTaskMessage(message);
    expect(result).not.toBeNull();
    expect(result!.toolName).toBe('browser_click');
    expect(result!.content).toBe('Using tool: Clicking element');
  });

  it('extracts raw JPEG base64 screenshot payloads from tool output', () => {
    const rawJpeg = '/9j/' + 'A'.repeat(180);

    const message: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: '6',
        sessionID: 's1',
        messageID: 'm6',
        type: 'tool_use',
        tool: 'browser_screenshot',
        state: {
          status: 'completed',
          output: `Screenshot payload: "${rawJpeg}"`,
        },
      },
    } as OpenCodeMessage;

    const result = toTaskMessage(message);

    expect(result).not.toBeNull();
    expect(result!.attachments).toBeDefined();
    expect(result!.attachments![0].data.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
    expect(result!.content).toContain('[Screenshot]');
  });

  it('drops oversized screenshot attachments to keep IPC payloads small', () => {
    const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(250_000)}`;
    const message: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: '6',
        sessionID: 's1',
        messageID: 'm6',
        type: 'tool_use',
        tool: 'browser_script',
        state: { status: 'completed', output: oversizedDataUrl },
      },
    } as OpenCodeMessage;

    const result = toTaskMessage(message);
    expect(result).not.toBeNull();
    expect(result!.content).toContain('[Screenshot captured]');
    expect(result!.attachments).toBeUndefined();
  });

  // --- New behaviours from commercial PR #720 (OpenCode SDK cutover) -----------------

  it('emits a tool message in running state (previously dropped in OSS)', () => {
    const message: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: 'tool-part-1',
        sessionID: 'sess-A',
        messageID: 'm-running',
        type: 'tool_use',
        tool: 'bash',
        state: { status: 'running' },
      },
    } as OpenCodeMessage;

    const result = toTaskMessage(message);
    expect(result).not.toBeNull();
    expect(result!.toolStatus).toBe('running');
    expect(result!.toolName).toBe('bash');
    expect(result!.type).toBe('tool');
  });

  it('uses stable sessionID:partID as id for tool_use (enables upsert coalescing)', () => {
    const running: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: 'stable-1',
        sessionID: 'sess-B',
        messageID: 'm-run',
        type: 'tool_use',
        tool: 'read',
        state: { status: 'running' },
      },
    } as OpenCodeMessage;
    const completed: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: 'stable-1',
        sessionID: 'sess-B',
        messageID: 'm-done',
        type: 'tool_use',
        tool: 'read',
        state: { status: 'completed', output: 'hello world' },
      },
    } as OpenCodeMessage;

    const runRes = toTaskMessage(running);
    const doneRes = toTaskMessage(completed);
    expect(runRes!.id).toBe('sess-B:stable-1');
    expect(doneRes!.id).toBe('sess-B:stable-1');
    // Same id = store upsert collapses the two into one row
    expect(runRes!.id).toBe(doneRes!.id);
  });

  it('uses stable sessionID:messageID for assistant text messages', () => {
    const message: OpenCodeMessage = {
      type: 'text',
      part: {
        id: 'text-part',
        sessionID: 'sess-C',
        messageID: 'msg-42',
        type: 'text',
        text: 'Hello',
      },
    };
    const result = toTaskMessage(message);
    expect(result!.id).toBe('sess-C:msg-42');
  });

  it('stamps modelId / providerId from ModelContext on assistant message', () => {
    const message: OpenCodeMessage = {
      type: 'text',
      part: {
        id: 'p',
        sessionID: 's',
        messageID: 'm',
        type: 'text',
        text: 'Hello',
      },
    };
    const result = toTaskMessage(message, { modelId: 'claude-opus-4-6', providerId: 'anthropic' });
    expect(result!.modelId).toBe('claude-opus-4-6');
    expect(result!.providerId).toBe('anthropic');
  });

  it('stamps modelId / providerId on tool_use messages', () => {
    const message: OpenCodeMessage = {
      type: 'tool_use',
      part: {
        id: 'p',
        sessionID: 's',
        messageID: 'm',
        type: 'tool_use',
        tool: 'bash',
        state: { status: 'running' },
      },
    } as OpenCodeMessage;
    const result = toTaskMessage(message, { modelId: 'gpt-5.4', providerId: 'openai' });
    expect(result!.modelId).toBe('gpt-5.4');
    expect(result!.providerId).toBe('openai');
  });

  it('omits modelId / providerId when ModelContext not provided (back-compat)', () => {
    const message: OpenCodeMessage = {
      type: 'text',
      part: {
        id: 'p',
        sessionID: 's',
        messageID: 'm',
        type: 'text',
        text: 'Hello',
      },
    };
    const result = toTaskMessage(message);
    expect(result!.modelId).toBeUndefined();
    expect(result!.providerId).toBeUndefined();
  });

  it('derives timestamp from the SDK message (not call time)', () => {
    const fixed = 1_700_000_000_000;
    const message: OpenCodeMessage = {
      type: 'text',
      timestamp: fixed,
      part: {
        id: 'p',
        sessionID: 's',
        messageID: 'm',
        type: 'text',
        text: 'Hello',
      },
    };
    const result = toTaskMessage(message);
    expect(result!.timestamp).toBe(new Date(fixed).toISOString());
  });
});

describe('mergeTaskMessage', () => {
  const base: TaskMessage = {
    id: 's:1',
    type: 'tool',
    content: '',
    toolName: 'bash',
    toolStatus: 'running',
    timestamp: '2026-04-15T00:00:00.000Z',
    modelId: 'claude-opus-4-6',
  };

  it('takes newer toolStatus on running -> completed transition', () => {
    const incoming: TaskMessage = {
      ...base,
      content: 'done',
      toolStatus: 'completed',
      timestamp: '2026-04-15T00:00:05.000Z',
    };
    const merged = mergeTaskMessage(base, incoming);
    expect(merged.toolStatus).toBe('completed');
    expect(merged.content).toBe('done');
  });

  it('preserves original timestamp to avoid UI re-sorting', () => {
    const incoming: TaskMessage = {
      ...base,
      toolStatus: 'completed',
      timestamp: '2026-04-15T00:00:05.000Z',
    };
    const merged = mergeTaskMessage(base, incoming);
    expect(merged.timestamp).toBe(base.timestamp);
  });

  it('preserves existing modelId/providerId when incoming omits them', () => {
    const incoming: TaskMessage = {
      id: base.id,
      type: base.type,
      content: 'update',
      toolStatus: 'completed',
      timestamp: '2026-04-15T00:00:05.000Z',
    };
    const merged = mergeTaskMessage(base, incoming);
    expect(merged.modelId).toBe('claude-opus-4-6');
  });

  it('prefers incoming modelId/providerId when provided', () => {
    const incoming: TaskMessage = {
      ...base,
      modelId: 'gpt-5.4',
      providerId: 'openai',
    };
    const merged = mergeTaskMessage(base, incoming);
    expect(merged.modelId).toBe('gpt-5.4');
    expect(merged.providerId).toBe('openai');
  });
});

describe('extractScreenshots', () => {
  it('keeps at most one screenshot attachment', () => {
    const screenshot = `data:image/png;base64,${'A'.repeat(120)}`;
    const output = `${screenshot}\n${screenshot}`;
    const result = extractScreenshots(output);
    expect(result.attachments).toHaveLength(1);
  });
});

describe('sanitizeToolOutput', () => {
  it('strips [ref=eNN] patterns and collapses extra spaces', () => {
    const result = sanitizeToolOutput('Click [ref=e42] button', false);
    expect(result).toBe('Click button');
  });

  it('strips [cursor=pointer] attributes and collapses extra spaces', () => {
    const result = sanitizeToolOutput('Element [cursor=pointer] here', false);
    expect(result).toBe('Element here');
  });
});

describe('getToolDisplayName', () => {
  it('returns null for hidden tools', () => {
    expect(getToolDisplayName('discard')).toBeNull();
    expect(getToolDisplayName('extract')).toBeNull();
    expect(getToolDisplayName('context_info')).toBeNull();
    expect(getToolDisplayName('prune')).toBeNull();
    expect(getToolDisplayName('distill')).toBeNull();
    expect(getToolDisplayName('mcp_prune')).toBeNull();
    expect(getToolDisplayName('mcp_distill')).toBeNull();
  });

  it('returns display name for mapped tools', () => {
    expect(getToolDisplayName('browser_click')).toBe('Clicking element');
  });

  it('returns original name for unknown tools', () => {
    expect(getToolDisplayName('some_custom_tool')).toBe('some_custom_tool');
  });
});
