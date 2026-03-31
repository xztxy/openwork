/**
 * Types for SpeechInputButton component.
 */

export interface SpeechInputButtonProps {
  /**
   * Whether currently recording
   */
  isRecording: boolean;

  /**
   * Whether currently transcribing
   */
  isTranscribing: boolean;

  /**
   * Current recording duration in milliseconds
   */
  recordingDuration?: number;

  /**
   * Error state
   */
  error?: Error | null;

  /**
   * Whether speech input is configured
   */
  isConfigured?: boolean;

  /**
   * Whether disabled (e.g., during task execution)
   */
  disabled?: boolean;

  /**
   * Called when user clicks to start recording
   */
  onStartRecording?: () => void;

  /**
   * Called when user clicks to stop recording
   */
  onStopRecording?: () => void;

  /**
   * Called when user clicks to cancel recording
   */
  onCancel?: () => void;

  /**
   * Called when user clicks to retry
   */
  onRetry?: () => void;

  /**
   * Called when user clicks the button while not configured
   * (to open settings dialog)
   */
  onOpenSettings?: () => void;

  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg';

  /**
   * Custom CSS classes
   */
  className?: string;

  /**
   * Custom tooltip text
   */
  tooltipText?: string;
}

/**
 * Format milliseconds to MM:SS display
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
