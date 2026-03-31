import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic imports
// ---------------------------------------------------------------------------

vi.mock('@accomplish_ai/agent-core', async () => {
  const actual = await vi.importActual<typeof import('@accomplish_ai/agent-core')>(
    '@accomplish_ai/agent-core',
  );
  return {
    ...actual,
    createTaskId: vi.fn(() => 'test-task-id'),
  };
});

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

class MockWhatsAppService extends EventEmitter {
  readonly channelType = 'whatsapp';
  sentMessages: Array<{ recipientId: string; text: string }> = [];

  async sendMessage(recipientId: string, text: string) {
    this.sentMessages.push({ recipientId, text });
  }

  getStatus() {
    return 'connected';
  }

  getQrCode() {
    return null;
  }

  getQrIssuedAt() {
    return null;
  }

  async connect() {}
  async disconnect() {}
  dispose() {
    this.removeAllListeners();
  }
}

class MockTaskService extends EventEmitter {
  tasks: Array<{ id: string; sessionId?: string; status: string }> = [];
  startTaskMock = vi.fn();

  async startTask(params: { prompt: string; taskId: string; sessionId?: string }) {
    this.startTaskMock(params);
    this.tasks.push({ id: params.taskId, status: 'running' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { id: params.taskId, status: 'running' } as any;
  }

  listTasks() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.tasks as any;
  }
}

function createMockPermissionService() {
  return {
    resolvePermission: vi.fn(() => true),
    resolveQuestion: vi.fn(() => true),
    isFilePermissionRequest: vi.fn((id: string) => id.startsWith('file-perm-')),
    isQuestionRequest: vi.fn((id: string) => id.startsWith('question-')),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wireTaskBridge (daemon version)', () => {
  let service: MockWhatsAppService;
  let taskService: MockTaskService;
  let permissionService: ReturnType<typeof createMockPermissionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MockWhatsAppService();
    taskService = new MockTaskService();
    permissionService = createMockPermissionService();
  });

  // Helper to create the bridge via dynamic import (avoids mock ordering issues)
  async function createBridge() {
    const { wireTaskBridge } = await import('../../../src/whatsapp/wireTaskBridge.js');
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return wireTaskBridge(service as any, taskService as any, permissionService as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  describe('permission auto-deny (P1 fix)', () => {
    it('should auto-deny file permission requests using PermissionRequest.id', async () => {
      const { bridge } = await createBridge();
      bridge.setEnabled(true);
      bridge.setOwnerJid('1234@s.whatsapp.net');

      // Simulate a message that triggers a task
      service.emit('message', {
        messageId: 'msg-1',
        senderId: '1234@s.whatsapp.net',
        text: 'test task',
        timestamp: Date.now(),
        isGroup: false,
        isFromMe: true,
      });

      // Wait for task to start
      await vi.waitFor(() => {
        expect(taskService.startTaskMock).toHaveBeenCalled();
      });

      // Simulate a file permission request from the task
      // TaskService emits raw PermissionRequest with id at top level
      taskService.emit('permission', {
        id: 'file-perm-123',
        taskId: 'test-task-id',
        type: 'file',
        fileOperation: 'create',
        filePath: '/tmp/test.txt',
      });

      expect(permissionService.resolvePermission).toHaveBeenCalledWith('file-perm-123', false);
    });

    it('should auto-deny question requests using PermissionRequest.id', async () => {
      const { bridge } = await createBridge();
      bridge.setEnabled(true);
      bridge.setOwnerJid('1234@s.whatsapp.net');

      service.emit('message', {
        messageId: 'msg-2',
        senderId: '1234@s.whatsapp.net',
        text: 'another task',
        timestamp: Date.now(),
        isGroup: false,
        isFromMe: true,
      });

      await vi.waitFor(() => {
        expect(taskService.startTaskMock).toHaveBeenCalled();
      });

      // Simulate a question request
      taskService.emit('permission', {
        id: 'question-456',
        taskId: 'test-task-id',
        type: 'question',
        question: 'Which option?',
      });

      expect(permissionService.resolveQuestion).toHaveBeenCalledWith('question-456', {
        denied: true,
      });
    });

    it('should send denial message to WhatsApp user', async () => {
      const { bridge } = await createBridge();
      bridge.setEnabled(true);
      bridge.setOwnerJid('1234@s.whatsapp.net');

      service.emit('message', {
        messageId: 'msg-3',
        senderId: '1234@s.whatsapp.net',
        text: 'task needing permission',
        timestamp: Date.now(),
        isGroup: false,
        isFromMe: true,
      });

      await vi.waitFor(() => {
        expect(taskService.startTaskMock).toHaveBeenCalled();
      });

      taskService.emit('permission', {
        id: 'file-perm-789',
        taskId: 'test-task-id',
        type: 'file',
      });

      const denialMsg = service.sentMessages.find((m) =>
        m.text.includes('cannot be auto-approved'),
      );
      expect(denialMsg).toBeDefined();
    });
  });

  describe('listener cleanup', () => {
    it('should remove task listeners on complete', async () => {
      const { bridge } = await createBridge();
      bridge.setEnabled(true);
      bridge.setOwnerJid('1234@s.whatsapp.net');

      const initialListeners = taskService.listenerCount('complete');

      service.emit('message', {
        messageId: 'msg-4',
        senderId: '1234@s.whatsapp.net',
        text: 'task to complete',
        timestamp: Date.now(),
        isGroup: false,
        isFromMe: true,
      });

      await vi.waitFor(() => {
        expect(taskService.startTaskMock).toHaveBeenCalled();
      });

      // Listeners should have been added
      expect(taskService.listenerCount('complete')).toBeGreaterThan(initialListeners);

      // Complete the task
      taskService.tasks[0] = { id: 'test-task-id', status: 'completed', sessionId: 'sess-1' };
      taskService.emit('complete', { taskId: 'test-task-id' });

      // After nextTick, listeners should be cleaned up
      await new Promise((resolve) => process.nextTick(resolve));
      expect(taskService.listenerCount('complete')).toBe(initialListeners);
    });

    it('should remove task listeners on error', async () => {
      const { bridge } = await createBridge();
      bridge.setEnabled(true);
      bridge.setOwnerJid('1234@s.whatsapp.net');

      const initialListeners = taskService.listenerCount('error');

      service.emit('message', {
        messageId: 'msg-5',
        senderId: '1234@s.whatsapp.net',
        text: 'task to fail',
        timestamp: Date.now(),
        isGroup: false,
        isFromMe: true,
      });

      await vi.waitFor(() => {
        expect(taskService.startTaskMock).toHaveBeenCalled();
      });

      taskService.emit('error', { taskId: 'test-task-id', error: 'test error' });

      expect(taskService.listenerCount('error')).toBe(initialListeners);
    });
  });

  describe('session continuity (P2 fix)', () => {
    it('should read sessionId after nextTick to allow storage update', async () => {
      const { bridge } = await createBridge();
      bridge.setEnabled(true);
      bridge.setOwnerJid('1234@s.whatsapp.net');

      service.emit('message', {
        messageId: 'msg-6',
        senderId: '1234@s.whatsapp.net',
        text: 'session test',
        timestamp: Date.now(),
        isGroup: false,
        isFromMe: true,
      });

      await vi.waitFor(() => {
        expect(taskService.startTaskMock).toHaveBeenCalled();
      });

      // Simulate task-callbacks.ts behavior: complete fires, then storage updates
      taskService.emit('complete', { taskId: 'test-task-id' });

      // Simulate storage being updated synchronously after emit (like task-callbacks does)
      taskService.tasks[0] = { id: 'test-task-id', status: 'completed', sessionId: 'sess-abc' };

      // The bridge reads storage on nextTick — so it should find the sessionId
      await new Promise((resolve) => process.nextTick(resolve));

      // Verify session was stored (by checking the bridge internals via getSessionForSender)
      const nextSessionId = bridge.getSessionForSender('1234@s.whatsapp.net');
      expect(nextSessionId).toBe('sess-abc');
    });
  });

  describe('owner identity wiring', () => {
    it('should set ownerJid from phoneNumber event', async () => {
      const { bridge } = await createBridge();

      service.emit('phoneNumber', '5551234567');

      expect(bridge.getOwnerJid()).toBe('5551234567@s.whatsapp.net');
    });

    it('should set ownerLid from ownerLid event', async () => {
      const { bridge } = await createBridge();

      service.emit('ownerLid', 'lid-abc@lid');

      expect(bridge.getOwnerLid()).toBe('lid-abc@lid');
    });
  });
});
