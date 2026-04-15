import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Round-trip persistence test for the new TaskMessage fields introduced by
 * migration v029 (OpenCode SDK cutover port, commercial PR #720):
 *   - tool_status
 *   - model_id
 *   - provider_id
 *
 * Covers both write paths — `saveTask()` bulk insert and `addTaskMessage()` —
 * and the read path via `rowToTask()` → `getMessagesForTask()`.
 *
 * Requires the better-sqlite3 native module. Skipped on ABI mismatch.
 */

describe('TaskMessage new fields round-trip (v029)', () => {
  let testDir: string;
  let dbPath: string;
  let databaseModule: typeof import('../../../src/storage/database.js') | null = null;
  let repoModule: typeof import('../../../src/storage/repositories/taskHistory.js') | null = null;

  beforeAll(async () => {
    if (process.env.SKIP_SQLITE_TESTS) {
      console.warn('Skipping: better-sqlite3 native module not available');
      return;
    }
    try {
      const BetterSqlite3 = await import('better-sqlite3');
      const probe = new (
        BetterSqlite3 as unknown as { default: new (p: string) => { close(): void } }
      ).default(':memory:');
      probe.close();
      databaseModule = await import('../../../src/storage/database.js');
      repoModule = await import('../../../src/storage/repositories/taskHistory.js');
    } catch (_err) {
      console.warn('Skipping: better-sqlite3 native module not available');
    }
  });

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `msg-fields-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'test.db');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (databaseModule) databaseModule.resetDatabaseInstance();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('persists toolStatus / modelId / providerId via saveTask bulk insert', () => {
    if (!databaseModule || !repoModule) return;
    databaseModule.initializeDatabase({ databasePath: dbPath });

    const task = {
      id: 'task-bulk-1',
      prompt: 'do the thing',
      status: 'completed' as const,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-1',
          type: 'tool' as const,
          content: 'bash output',
          toolName: 'bash',
          toolStatus: 'completed' as const,
          timestamp: new Date().toISOString(),
          modelId: 'claude-opus-4-6',
          providerId: 'anthropic',
        },
      ],
    };

    repoModule.saveTask(task);

    const loaded = repoModule.getTask(task.id);
    expect(loaded).toBeDefined();
    expect(loaded!.messages).toHaveLength(1);
    const m = loaded!.messages[0];
    expect(m.toolStatus).toBe('completed');
    expect(m.modelId).toBe('claude-opus-4-6');
    expect(m.providerId).toBe('anthropic');
    expect(m.toolName).toBe('bash');
  });

  it('persists toolStatus=running via addTaskMessage and survives update to completed', () => {
    if (!databaseModule || !repoModule) return;
    databaseModule.initializeDatabase({ databasePath: dbPath });

    const taskId = 'task-add-1';
    repoModule.saveTask({
      id: taskId,
      prompt: 'streaming tool',
      status: 'running',
      createdAt: new Date().toISOString(),
      messages: [],
    });

    const firstTimestamp = new Date().toISOString();
    repoModule.addTaskMessage(taskId, {
      id: 'msg-running',
      type: 'tool',
      content: '',
      toolName: 'read',
      toolStatus: 'running',
      timestamp: firstTimestamp,
      modelId: 'gpt-5.4',
      providerId: 'openai',
    });

    const afterRunning = repoModule.getTask(taskId);
    expect(afterRunning!.messages).toHaveLength(1);
    expect(afterRunning!.messages[0].toolStatus).toBe('running');
    expect(afterRunning!.messages[0].modelId).toBe('gpt-5.4');

    // REGRESSION (Codex P1 #1): the SDK adapter emits the SAME stable
    // message ID for running and then completed states of a tool row.
    // Before the upsert fix, the second addTaskMessage call threw
    // `SQLITE_CONSTRAINT_PRIMARYKEY` because the insert was plain. The
    // renderer-side mergeTaskMessage helper collapsed the duplicate in
    // memory, but persistence broke on every tool-state transition.
    repoModule.addTaskMessage(taskId, {
      id: 'msg-running', // SAME ID — this is the point of the regression.
      type: 'tool',
      content: 'file contents here',
      toolName: 'read',
      toolStatus: 'completed',
      // New timestamp on the caller side — upsert preserves the ORIGINAL
      // timestamp so the UI sort order stays stable.
      timestamp: new Date(Date.now() + 5_000).toISOString(),
      modelId: 'gpt-5.4',
      providerId: 'openai',
    });

    const afterCompleted = repoModule.getTask(taskId);
    expect(afterCompleted!.messages).toHaveLength(1); // still ONE row
    expect(afterCompleted!.messages[0].id).toBe('msg-running');
    expect(afterCompleted!.messages[0].toolStatus).toBe('completed');
    expect(afterCompleted!.messages[0].content).toBe('file contents here');
    // Timestamp preserved from the first insert.
    expect(afterCompleted!.messages[0].timestamp).toBe(firstTimestamp);
  });

  it('accepts messages without new fields (back-compat, NULL columns)', () => {
    if (!databaseModule || !repoModule) return;
    databaseModule.initializeDatabase({ databasePath: dbPath });

    const task = {
      id: 'task-back-compat',
      prompt: 'legacy-shape',
      status: 'completed' as const,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-legacy',
          type: 'assistant' as const,
          content: 'hello',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    repoModule.saveTask(task);
    const loaded = repoModule.getTask(task.id);
    expect(loaded!.messages[0].toolStatus).toBeUndefined();
    expect(loaded!.messages[0].modelId).toBeUndefined();
    expect(loaded!.messages[0].providerId).toBeUndefined();
  });

  it('does not accumulate attachments across repeat addTaskMessage calls (Codex R3 P2)', () => {
    if (!databaseModule || !repoModule) return;
    databaseModule.initializeDatabase({ databasePath: dbPath });

    const taskId = 'task-attachment-dedupe';
    repoModule.saveTask({
      id: taskId,
      prompt: 'tool with attachment',
      status: 'running',
      createdAt: new Date().toISOString(),
      messages: [],
    });

    const attachment = {
      type: 'image' as const,
      data: 'data:image/png;base64,iVBORw0KGgo=',
      label: 'screenshot',
    };

    // First write — running with attachment.
    repoModule.addTaskMessage(taskId, {
      id: 'msg-stable',
      type: 'tool',
      content: '',
      toolName: 'dev-browser-mcp',
      toolStatus: 'running',
      timestamp: new Date().toISOString(),
      attachments: [attachment],
    });

    // Second write — completed with the SAME attachment. The SDK's
    // `mergeTaskMessage` helper emits the FULL attachment list on every
    // update, so repeat writes with the same payload are common. Before
    // the DELETE+INSERT fix this INSERT OR IGNORE against a schema with
    // no UNIQUE constraint silently duplicated the row.
    repoModule.addTaskMessage(taskId, {
      id: 'msg-stable',
      type: 'tool',
      content: 'finished',
      toolName: 'dev-browser-mcp',
      toolStatus: 'completed',
      timestamp: new Date().toISOString(),
      attachments: [attachment],
    });

    const loaded = repoModule.getTask(taskId);
    expect(loaded!.messages).toHaveLength(1);
    // Exactly ONE attachment, not two.
    expect(loaded!.messages[0].attachments).toHaveLength(1);
    expect(loaded!.messages[0].attachments![0].label).toBe('screenshot');
  });

  it('preserves toolStatus=error and round-trips via rowToTask', () => {
    if (!databaseModule || !repoModule) return;
    databaseModule.initializeDatabase({ databasePath: dbPath });

    const taskId = 'task-error';
    repoModule.saveTask({
      id: taskId,
      prompt: 'failing tool',
      status: 'failed',
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-error',
          type: 'tool',
          content: 'EACCES',
          toolName: 'write',
          toolStatus: 'error',
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const loaded = repoModule.getTask(taskId);
    expect(loaded!.messages[0].toolStatus).toBe('error');
  });
});
