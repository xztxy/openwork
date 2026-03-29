import { useRef, useEffect, type RefObject, type KeyboardEvent } from 'react';

interface SlashCommandHandle {
  handleKeyDown: (e: KeyboardEvent) => boolean;
}

interface UseTaskInputBehaviorOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  isInputDisabled: boolean;
  isOverLimit: boolean;
  autoFocus: boolean;
  autoSubmitOnTranscription: boolean;
  canSubmit: boolean;
  isLoading: boolean;
  isRecording: boolean;
  slashCommand: SlashCommandHandle;
  onSubmit: () => void;
}

export function useTaskInputBehavior({
  textareaRef,
  value,
  isInputDisabled,
  isOverLimit,
  autoFocus,
  autoSubmitOnTranscription,
  canSubmit,
  isLoading,
  isRecording,
  slashCommand,
  onSubmit,
}: UseTaskInputBehaviorOptions) {
  const pendingAutoSubmitRef = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus, textareaRef]);

  useEffect(() => {
    if (!autoSubmitOnTranscription || isInputDisabled || isOverLimit) {
      return;
    }
    if (pendingAutoSubmitRef.current && value === pendingAutoSubmitRef.current) {
      pendingAutoSubmitRef.current = null;
      onSubmit();
    }
  }, [autoSubmitOnTranscription, isInputDisabled, isOverLimit, onSubmit, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value, textareaRef]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (slashCommand.handleKeyDown(e)) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit && !isRecording && !isLoading) {
        onSubmit();
      }
    }
  };

  return { pendingAutoSubmitRef, handleKeyDown };
}
