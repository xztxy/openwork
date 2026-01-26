import { describe, it, expect, vi } from 'vitest';
import { CompletionEnforcer } from '@main/opencode/completion/completion-enforcer';
import type { CompletionEnforcerCallbacks } from '@main/opencode/completion/completion-enforcer';

function createMockCallbacks(): CompletionEnforcerCallbacks {
  return {
    onStartVerification: vi.fn().mockResolvedValue(undefined),
    onStartContinuation: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn(),
    onDebug: vi.fn(),
  };
}

describe('CompletionEnforcer', () => {
  describe('Conversational response (no tool engagement)', () => {
    it('should return complete on stop when no tools were ever used', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      const action = enforcer.handleStepFinish('stop');

      expect(action).toBe('complete');
      expect(callbacks.onDebug).toHaveBeenCalledWith(
        'conversational_complete',
        expect.stringContaining('conversational response'),
      );
    });

    it('should return complete on end_turn when no tools were ever used', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      const action = enforcer.handleStepFinish('end_turn');

      expect(action).toBe('complete');
    });

    it('should schedule continuation when tools WERE used but complete_task not called', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      enforcer.recordToolEngagement();
      const action = enforcer.handleStepFinish('stop');

      expect(action).toBe('pending');
      expect(callbacks.onDebug).toHaveBeenCalledWith(
        'continuation',
        expect.stringContaining('Scheduled continuation'),
      );
    });

    it('should return continue for non-stop reasons regardless of tool engagement', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      expect(enforcer.handleStepFinish('tool-calls')).toBe('continue');
      expect(enforcer.handleStepFinish('tool_use')).toBe('continue');
    });

    it('should reset hasEngagedWithTools on reset()', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      enforcer.recordToolEngagement();
      enforcer.reset();

      // After reset, should behave as conversational again
      const action = enforcer.handleStepFinish('stop');
      expect(action).toBe('complete');
    });
  });

  describe('complete_task detection overrides conversational path', () => {
    it('should follow verification path even without tool engagement if complete_task(success) called', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      // Agent calls complete_task(success) without any prior tools
      enforcer.handleCompleteTaskDetection({
        status: 'success',
        summary: 'Greeted user',
        original_request_summary: 'Hey',
      });

      const action = enforcer.handleStepFinish('stop');

      // Should follow verification path, not conversational complete
      expect(action).toBe('pending');
    });

    it('should complete immediately for blocked status without tool engagement', () => {
      const callbacks = createMockCallbacks();
      const enforcer = new CompletionEnforcer(callbacks);

      enforcer.handleCompleteTaskDetection({
        status: 'blocked',
        summary: 'Cannot proceed',
        original_request_summary: 'Hey',
      });

      const action = enforcer.handleStepFinish('stop');

      expect(action).toBe('complete');
    });
  });
});
