import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { saveContext, loadContext, deleteContext, listContexts } from './storage.js';
import type { SessionContext } from './types.js';

// Note: The storage module uses ~/.accomplish/context-memory/ as the storage directory
// Tests will use real storage location but with unique task IDs

describe('storage', () => {
  const testTaskIds: string[] = [];

  // Helper to create a unique test task ID
  function createTestTaskId(): string {
    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testTaskIds.push(id);
    return id;
  }

  afterEach(() => {
    // Clean up all test contexts
    for (const taskId of testTaskIds) {
      try {
        deleteContext(taskId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    testTaskIds.length = 0;
  });

  it('should save and load context', () => {
    const taskId = createTestTaskId();
    const context: SessionContext = {
      sessionId: 'test-session',
      taskId,
      updatedAt: new Date().toISOString(),
      originalRequest: 'Test request',
      summary: 'Test summary',
      keyDecisions: ['Decision 1'],
      filesModified: [],
      currentStatus: 'Testing',
      recentToolCalls: [],
      blockers: [],
    };

    saveContext(context);
    const loaded = loadContext(taskId);

    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe('test-session');
    expect(loaded?.originalRequest).toBe('Test request');
    expect(loaded?.keyDecisions).toEqual(['Decision 1']);
  });

  it('should return null for non-existent context', () => {
    const loaded = loadContext('non-existent-task-id-12345');
    expect(loaded).toBeNull();
  });

  it('should delete context', () => {
    const taskId = createTestTaskId();
    const context: SessionContext = {
      sessionId: 'test-session',
      taskId,
      updatedAt: new Date().toISOString(),
      originalRequest: 'Test',
      summary: 'Test',
      keyDecisions: [],
      filesModified: [],
      currentStatus: 'Test',
      recentToolCalls: [],
      blockers: [],
    };

    saveContext(context);
    expect(loadContext(taskId)).not.toBeNull();

    const deleted = deleteContext(taskId);
    expect(deleted).toBe(true);
    expect(loadContext(taskId)).toBeNull();
  });

  it('should return false when deleting non-existent context', () => {
    const deleted = deleteContext('non-existent-task-id-67890');
    expect(deleted).toBe(false);
  });

  it('should update existing context', () => {
    const taskId = createTestTaskId();
    const context1: SessionContext = {
      sessionId: 'session-1',
      taskId,
      updatedAt: new Date().toISOString(),
      originalRequest: 'Original request',
      summary: 'First summary',
      keyDecisions: ['Decision 1'],
      filesModified: [],
      currentStatus: 'Working',
      recentToolCalls: [],
      blockers: [],
    };

    saveContext(context1);

    const context2: SessionContext = {
      ...context1,
      summary: 'Updated summary',
      keyDecisions: ['Decision 1', 'Decision 2'],
      updatedAt: new Date().toISOString(),
    };

    saveContext(context2);
    const loaded = loadContext(taskId);

    expect(loaded?.summary).toBe('Updated summary');
    expect(loaded?.keyDecisions).toEqual(['Decision 1', 'Decision 2']);
  });

  it('should store and retrieve file modifications', () => {
    const taskId = createTestTaskId();
    const context: SessionContext = {
      sessionId: 'test-session',
      taskId,
      updatedAt: new Date().toISOString(),
      originalRequest: 'Test',
      summary: 'Test',
      keyDecisions: [],
      filesModified: [
        { path: '/src/index.ts', operation: 'modified', timestamp: new Date().toISOString() },
        { path: '/src/utils.ts', operation: 'created', timestamp: new Date().toISOString() },
      ],
      currentStatus: 'Test',
      recentToolCalls: [],
      blockers: [],
    };

    saveContext(context);
    const loaded = loadContext(taskId);

    expect(loaded?.filesModified).toHaveLength(2);
    expect(loaded?.filesModified[0].path).toBe('/src/index.ts');
    expect(loaded?.filesModified[0].operation).toBe('modified');
  });

  it('should sanitize task IDs to prevent path traversal', () => {
    const taskId = createTestTaskId();
    const maliciousTaskId = `${taskId}/../../../etc/passwd`;

    const context: SessionContext = {
      sessionId: 'test-session',
      taskId: maliciousTaskId,
      updatedAt: new Date().toISOString(),
      originalRequest: 'Test',
      summary: 'Test',
      keyDecisions: [],
      filesModified: [],
      currentStatus: 'Test',
      recentToolCalls: [],
      blockers: [],
    };

    // Should not throw and should sanitize the path
    saveContext(context);

    // The sanitized version should be loadable
    // The path traversal characters get replaced with underscores
    const sanitizedId = maliciousTaskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    testTaskIds.push(sanitizedId); // Track for cleanup

    const loaded = loadContext(maliciousTaskId);
    expect(loaded).not.toBeNull();
  });
});
