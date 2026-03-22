/**
 * BrowserPreview — Embedded live CDP screencast in the execution chat.
 *
 * Receives base64 JPEG frames from the main process via IPC (browser:frame),
 * URL navigation events (browser:navigate), and status events (browser:status).
 *
 * Features:
 *  - Displays live browser frames as they arrive
 *  - Shows current URL and streaming/loading status
 *  - Collapsible / expandable panel
 *  - Auto-starts preview when a browser_* tool is detected (dhruvawani17, PR #489)
 *  - Pauses frame updates when the document/tab is hidden
 *  - Smooth Framer Motion transitions (david-mamani, PR #553)
 *
 * Contributed by:
 *  - david-mamani (PR #553) — component structure, animation, status indicator
 *  - dhruvawani17 (PR #489) — auto-start on browser_* tool, visibility pause
 *  - samarthsinh2660 (PR #414) — taskStore integration, collapse/expand
 *
 * ENG-695
 */

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Loader2, AlertCircle, Monitor, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { springs } from '../../lib/animations';

interface BrowserPreviewProps {
  taskId: string;
  /** The currently active tool name — auto-starts the screencast when a browser_* tool is detected. */
  currentTool?: string | null;
  className?: string;
}

type ViewStatus = 'idle' | 'starting' | 'streaming' | 'stopping' | 'error';

function StatusIndicator({ status }: { status: ViewStatus }) {
  if (status === 'streaming') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Live
      </span>
    );
  }
  if (status === 'starting') {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Connecting…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" />
        Error
      </span>
    );
  }
  return null;
}

export const BrowserPreview = memo(function BrowserPreview({
  taskId,
  currentTool,
  className,
}: BrowserPreviewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const isPausedRef = useRef(false);
  const screencastStartedRef = useRef(false);

  const [frameData, setFrameData] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [status, setStatus] = useState<ViewStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Pause frame updates when the tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      isPausedRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Auto-start screencast when a browser_* tool becomes active
  // Contributed by dhruvawani17 (PR #489)
  useEffect(() => {
    if (!currentTool) return;
    const isBrowserTool =
      currentTool.startsWith('browser_') && currentTool !== 'browser_screencast';
    if (!isBrowserTool || screencastStartedRef.current) return;

    const api = window.accomplish;
    if (!api?.startBrowserPreview) return;

    screencastStartedRef.current = true;
    setStatus('starting');

    api.startBrowserPreview(taskId).catch(() => {
      // Dev-browser server may not be ready yet — reset so we can retry on next tool call
      screencastStartedRef.current = false;
      setStatus('idle');
    });
  }, [currentTool, taskId]);

  // Subscribe to IPC events from the main process
  const handleFrame = useCallback(
    (event: { taskId: string; pageName: string; frame: string; timestamp: number }) => {
      if (event.taskId !== taskId) return;
      if (isPausedRef.current) return;
      setFrameData(event.frame);
      if (imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${event.frame}`;
      }
      setStatus('streaming');
    },
    [taskId],
  );

  const handleNavigate = useCallback(
    (event: { taskId: string; pageName: string; url: string }) => {
      if (event.taskId !== taskId) return;
      setCurrentUrl(event.url);
    },
    [taskId],
  );

  const handleStatus = useCallback(
    (event: { taskId: string; pageName: string; status: string; message?: string }) => {
      if (event.taskId !== taskId) return;
      setStatus(event.status as ViewStatus);
      if (event.message) {
        setError(event.message);
      } else {
        setError(undefined);
      }
    },
    [taskId],
  );

  useEffect(() => {
    const api = window.accomplish;
    if (!api) return;

    const cleanups: (() => void)[] = [];

    if (api.onBrowserFrame) cleanups.push(api.onBrowserFrame(handleFrame));
    if (api.onBrowserNavigate) cleanups.push(api.onBrowserNavigate(handleNavigate));
    if (api.onBrowserStatus) cleanups.push(api.onBrowserStatus(handleStatus));

    return () => {
      for (const cleanup of cleanups) cleanup();
      // Stop preview when component unmounts
      api.stopBrowserPreview?.(taskId).catch(() => {});
    };
  }, [taskId, handleFrame, handleNavigate, handleStatus]);

  // Don't render until we have at least a starting state or a frame
  if (status === 'idle' && !frameData) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={cn(
        'bg-card border border-border rounded-2xl overflow-hidden max-w-[90%] mt-2',
        className,
      )}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
        <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs text-muted-foreground truncate flex-1 font-mono">
          {currentUrl || 'Browser Preview'}
        </span>
        <StatusIndicator status={status} />
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-muted-foreground hover:text-foreground transition-colors ml-1"
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Content area */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="relative aspect-video bg-black">
              <AnimatePresence mode="wait">
                {status === 'streaming' || (status === 'starting' && frameData) ? (
                  <motion.div
                    key="frame"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full"
                  >
                    <img
                      ref={imgRef}
                      alt="Browser preview"
                      className="w-full h-full object-contain"
                      draggable={false}
                      src={frameData ? `data:image/jpeg;base64,${frameData}` : undefined}
                    />
                    {status === 'starting' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <div className="flex items-center gap-2 text-white/80">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="text-sm">Connecting…</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : status === 'error' ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <div className="flex flex-col items-center gap-2 text-destructive/80">
                      <AlertCircle className="h-8 w-8" />
                      <span className="text-sm">{error ?? 'Stream error'}</span>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                      <Monitor className="h-8 w-8" />
                      <span className="text-sm">Waiting for browser…</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
