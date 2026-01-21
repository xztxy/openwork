/**
 * CompletionEnforcer coordinates the completion enforcement flow.
 * Uses the explicit CompletionState machine and delegates actual task
 * spawning to the adapter via callbacks.
 */

import { CompletionState, CompletionFlowState, CompleteTaskArgs } from './completion-state';
import { getContinuationPrompt, getVerificationPrompt } from './prompts';

export interface CompletionEnforcerCallbacks {
  onStartVerification: (prompt: string) => Promise<void>;
  onStartContinuation: (prompt: string) => Promise<void>;
  onComplete: () => void;
  onDebug: (type: string, message: string, data?: unknown) => void;
}

export type StepFinishAction = 'continue' | 'pending' | 'complete';

export class CompletionEnforcer {
  private state: CompletionState;
  private callbacks: CompletionEnforcerCallbacks;

  constructor(callbacks: CompletionEnforcerCallbacks, maxContinuationAttempts: number = 20) {
    this.callbacks = callbacks;
    this.state = new CompletionState(maxContinuationAttempts);
  }

  /**
   * Called by adapter when complete_task tool detected.
   * Returns true if this was a new detection (not already processed).
   */
  handleCompleteTaskDetection(toolInput: unknown): boolean {
    // Already processed complete_task in current flow
    if (this.state.isCompleteTaskCalled() && !this.state.isInVerificationMode()) {
      return false;
    }

    const args = toolInput as {
      status?: string;
      summary?: string;
      original_request_summary?: string;
      remaining_work?: string;
    };

    const completeTaskArgs: CompleteTaskArgs = {
      status: args?.status || 'unknown',
      summary: args?.summary || '',
      original_request_summary: args?.original_request_summary || '',
      remaining_work: args?.remaining_work,
    };

    this.state.recordCompleteTaskCall(completeTaskArgs);

    this.callbacks.onDebug(
      'complete_task',
      `complete_task detected with status: ${completeTaskArgs.status}`,
      { args: completeTaskArgs, state: CompletionFlowState[this.state.getState()] }
    );

    return true;
  }

  /**
   * Called by adapter on step_finish event.
   * Returns action to take:
   * - 'continue': More steps expected, don't emit complete
   * - 'pending': Verification or continuation pending, don't emit complete
   * - 'complete': Task is done, emit complete
   */
  handleStepFinish(reason: string): StepFinishAction {
    // Only handle 'stop' or 'end_turn' (final completion)
    if (reason !== 'stop' && reason !== 'end_turn') {
      return 'continue';
    }

    // Check if verification is needed
    if (this.state.isPendingVerification()) {
      this.callbacks.onDebug(
        'verification',
        'Scheduling verification for completion claim',
        { summary: this.state.getCompleteTaskArgs()?.summary }
      );
      return 'pending'; // Let handleProcessExit start verification
    }

    // Check if agent stopped without calling complete_task
    if (!this.state.isCompleteTaskCalled()) {
      // If we're in verification mode and agent stops without re-calling complete_task,
      // it means they found issues and are continuing to work
      if (this.state.isInVerificationMode()) {
        this.state.verificationContinuing();
        this.callbacks.onDebug(
          'verification',
          'Agent continuing work after verification check'
        );
        return 'pending'; // Let process exit, agent will continue
      }

      // Try to schedule a continuation
      if (this.state.scheduleContinuation()) {
        this.callbacks.onDebug(
          'continuation',
          `Scheduled continuation prompt (attempt ${this.state.getContinuationAttempts()})`
        );
        return 'pending'; // Let handleProcessExit start continuation
      }

      // Max retries reached
      console.warn('[CompletionEnforcer] Agent stopped without complete_task after max attempts');
    }

    // Task is complete (either complete_task called and verified, or max retries)
    return 'complete';
  }

  /**
   * Called by adapter on process exit.
   * Triggers verification or continuation if pending.
   */
  async handleProcessExit(exitCode: number): Promise<void> {
    // Check if we need to verify a completion claim
    if (this.state.isPendingVerification() && exitCode === 0) {
      const args = this.state.getCompleteTaskArgs();
      const prompt = getVerificationPrompt(
        args?.summary || 'No summary provided',
        args?.original_request_summary || 'Unknown request'
      );

      this.state.startVerification();

      this.callbacks.onDebug(
        'verification',
        'Starting verification task',
        { claimedSummary: args?.summary, originalRequest: args?.original_request_summary }
      );

      await this.callbacks.onStartVerification(prompt);
      return;
    }

    // Check if we need to continue
    if (this.state.isPendingContinuation() && exitCode === 0) {
      const prompt = getContinuationPrompt();

      this.state.startContinuation();

      this.callbacks.onDebug(
        'continuation',
        `Starting continuation task (attempt ${this.state.getContinuationAttempts()})`
      );

      await this.callbacks.onStartContinuation(prompt);
      return;
    }

    // No pending actions
    if (this.state.isDone() || this.state.getState() === CompletionFlowState.COMPLETE_TASK_CALLED) {
      this.callbacks.onComplete();
    }
  }

  /**
   * Check if state indicates task should be marked complete.
   */
  shouldComplete(): boolean {
    return this.state.isDone() ||
           this.state.getState() === CompletionFlowState.COMPLETE_TASK_CALLED ||
           this.state.getState() === CompletionFlowState.MAX_RETRIES_REACHED;
  }

  /**
   * Reset for new task.
   */
  reset(): void {
    this.state.reset();
  }

  /**
   * Get current state for debugging/testing.
   */
  getState(): CompletionFlowState {
    return this.state.getState();
  }

  /**
   * Get continuation attempts count.
   */
  getContinuationAttempts(): number {
    return this.state.getContinuationAttempts();
  }
}
