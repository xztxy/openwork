import { useState, useRef, useCallback } from 'react';

/** Manages scroll state and handlers for the execution page message list. */
export function useExecutionScroll() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 150;
    setIsAtBottom(atBottom);
  }, []);

  return {
    messagesEndRef,
    scrollContainerRef,
    isAtBottom,
    setIsAtBottom,
    scrollToBottom,
    handleScroll,
  };
}
