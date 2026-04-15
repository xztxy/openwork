import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter } from '../../../../src/internal/classes/OpenCodeAdapter.js';

/**
 * REGRESSION (Codex R5 P1): when the SDK delivers a text `message.part.updated`
 * event BEFORE the matching `message.updated` (out-of-order ordering that
 * occurs on resumed sessions), the earlier default-deny in `handlePartUpdated`
 * dropped the assistant's reply forever. SQLite inspection of a repro confirmed
 * the turn-2 assistant row never landed in storage — the event was silently
 * discarded.
 *
 * Fix: text parts with unknown role are buffered per-messageID and flushed
 * on the subsequent `message.updated`:
 *   - role='assistant' → replay buffered parts as `message` events.
 *   - anything else → discard.
 *
 * These tests pin both branches.
 */
describe('OpenCodeAdapter text-part buffer (out-of-order handling)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function constructAdapter(): OpenCodeAdapter {
    return new OpenCodeAdapter(
      {
        platform: 'darwin',
        isPackaged: false,
        tempPath: '/tmp',
      },
      'tsk_textbuf_test',
    );
  }

  it('replays buffered text parts as message events when role resolves to assistant', () => {
    const adapter = constructAdapter();
    const emittedMessages: unknown[] = [];
    adapter.on('message', (msg) => {
      emittedMessages.push(msg);
    });

    // Text part arrives FIRST (out-of-order).
    (adapter as unknown as { handlePartUpdated: (part: unknown) => void }).handlePartUpdated({
      id: 'part_1',
      messageID: 'msg_assistant_1',
      sessionID: 'sess_1',
      type: 'text',
      text: '7 + 4 = 11',
    });

    // No message emitted yet — parent role not known.
    expect(emittedMessages).toHaveLength(0);

    // `message.updated` arrives SECOND, resolves parent's role as assistant.
    (adapter as unknown as { handleMessageUpdated: (info: unknown) => void }).handleMessageUpdated({
      id: 'msg_assistant_1',
      role: 'assistant',
    });

    // Buffered text is replayed as a message event.
    expect(emittedMessages).toHaveLength(1);
    const emitted = emittedMessages[0] as { type: string; part: { text: string } };
    expect(emitted.type).toBe('text');
    expect(emitted.part.text).toBe('7 + 4 = 11');
  });

  it('discards buffered text parts when role resolves to user (no phantom echo)', () => {
    const adapter = constructAdapter();
    const emittedMessages: unknown[] = [];
    adapter.on('message', (msg) => {
      emittedMessages.push(msg);
    });

    // User-prompt text part, arrives before its message.updated.
    (adapter as unknown as { handlePartUpdated: (part: unknown) => void }).handlePartUpdated({
      id: 'part_1',
      messageID: 'msg_user_1',
      sessionID: 'sess_1',
      type: 'text',
      text: 'how much is 7+4',
    });

    expect(emittedMessages).toHaveLength(0);

    // Role resolves to user.
    (adapter as unknown as { handleMessageUpdated: (info: unknown) => void }).handleMessageUpdated({
      id: 'msg_user_1',
      role: 'user',
    });

    // Buffered parts discarded — no phantom assistant bubble.
    expect(emittedMessages).toHaveLength(0);
  });

  it('still drops known-non-assistant text parts without buffering', () => {
    const adapter = constructAdapter();
    const emittedMessages: unknown[] = [];
    adapter.on('message', (msg) => {
      emittedMessages.push(msg);
    });

    // message.updated arrives first, establishing role.
    (adapter as unknown as { handleMessageUpdated: (info: unknown) => void }).handleMessageUpdated({
      id: 'msg_user_1',
      role: 'user',
    });

    // Text part arrives after, role already known as user → drop.
    (adapter as unknown as { handlePartUpdated: (part: unknown) => void }).handlePartUpdated({
      id: 'part_1',
      messageID: 'msg_user_1',
      sessionID: 'sess_1',
      type: 'text',
      text: 'how much is 7+4',
    });

    expect(emittedMessages).toHaveLength(0);
  });

  it('emits in-order when message.updated precedes message.part.updated (normal flow)', () => {
    const adapter = constructAdapter();
    const emittedMessages: unknown[] = [];
    adapter.on('message', (msg) => {
      emittedMessages.push(msg);
    });

    (adapter as unknown as { handleMessageUpdated: (info: unknown) => void }).handleMessageUpdated({
      id: 'msg_assistant_1',
      role: 'assistant',
    });

    (adapter as unknown as { handlePartUpdated: (part: unknown) => void }).handlePartUpdated({
      id: 'part_1',
      messageID: 'msg_assistant_1',
      sessionID: 'sess_1',
      type: 'text',
      text: '7 + 4 = 11',
    });

    expect(emittedMessages).toHaveLength(1);
    const emitted = emittedMessages[0] as { type: string; part: { text: string } };
    expect(emitted.type).toBe('text');
    expect(emitted.part.text).toBe('7 + 4 = 11');
  });
});
