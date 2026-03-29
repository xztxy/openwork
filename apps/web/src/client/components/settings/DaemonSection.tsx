/**
 * DaemonSection — Settings UI for daemon monitoring and control.
 *
 * Shows daemon status (running/stopped/reconnecting), uptime, active tasks,
 * control buttons (start/stop/restart), and close-button behavior setting.
 *
 * Rendered inside the General settings tab.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccomplish } from '@/lib/accomplish';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type DaemonStatus = 'running' | 'stopped' | 'reconnecting' | 'unknown';

interface PingResult {
  status: string;
  uptime: number;
}

function formatUptime(ms: number): string {
  if (ms <= 0) {
    return '—';
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function DaemonSection() {
  const accomplish = useAccomplish();
  const { t } = useTranslation('settings');

  const [status, setStatus] = useState<DaemonStatus>('unknown');
  const [uptime, setUptime] = useState(0);
  const [lastPing, setLastPing] = useState<Date | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<string>('keep-daemon');
  const [showWarning, setShowWarning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll daemon status
  const pollStatus = useCallback(async () => {
    try {
      const result: PingResult = await accomplish.daemonPing();
      if (result.status === 'ok') {
        setStatus('running');
        setUptime(result.uptime);
      } else {
        setStatus('stopped');
        setUptime(0);
      }
      setLastPing(new Date());
    } catch {
      setStatus('stopped');
      setUptime(0);
    }
  }, [accomplish]);

  useEffect(() => {
    void pollStatus();
    pollRef.current = setInterval(() => void pollStatus(), 10_000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [pollStatus]);

  // Load close behavior
  useEffect(() => {
    accomplish
      .getCloseBehavior()
      .then(setCloseBehavior)
      .catch(() => {});
  }, [accomplish]);

  // Control actions
  const handleRestart = async () => {
    setActionInProgress('restart');
    try {
      await accomplish.daemonRestart();
      await pollStatus();
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStop = async () => {
    setActionInProgress('stop');
    try {
      await accomplish.daemonStop();
      setStatus('stopped');
      setUptime(0);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStart = async () => {
    setActionInProgress('start');
    try {
      await accomplish.daemonStart();
      await pollStatus();
    } finally {
      setActionInProgress(null);
    }
  };

  // Close behavior change with double confirmation
  const handleCloseBehaviorChange = () => {
    if (closeBehavior === 'keep-daemon') {
      // Switching TO stop-daemon — need confirmation
      setShowWarning(true);
    } else {
      // Switching back to keep-daemon — no confirmation needed
      void accomplish.setCloseBehavior('keep-daemon');
      setCloseBehavior('keep-daemon');
    }
  };

  const handleWarningConfirm = () => {
    setShowWarning(false);
    setShowConfirm(true);
  };

  const handleFinalConfirm = () => {
    setShowConfirm(false);
    void accomplish.setCloseBehavior('stop-daemon');
    setCloseBehavior('stop-daemon');
  };

  const statusDot =
    status === 'running'
      ? 'bg-green-500'
      : status === 'reconnecting'
        ? 'bg-yellow-500'
        : 'bg-red-500';

  const statusLabel =
    status === 'running'
      ? 'Running'
      : status === 'reconnecting'
        ? 'Reconnecting...'
        : status === 'stopped'
          ? 'Stopped'
          : 'Unknown';

  return (
    <>
      {/* Status Monitor */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          {t('daemon.status', 'Background Daemon')}
        </h4>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
            <div>
              <div className="font-medium text-foreground text-sm">{statusLabel}</div>
              {status === 'running' && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Uptime: {formatUptime(uptime)}
                  {lastPing && (
                    <span className="ml-2">
                      · Last ping: {Math.round((Date.now() - lastPing.getTime()) / 1000)}s ago
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status === 'running' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestart}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'restart' ? 'Restarting...' : 'Restart'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStop}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'stop' ? 'Stopping...' : 'Stop'}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStart}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === 'start' ? 'Starting...' : 'Start Daemon'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Close Button Behavior */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="font-medium text-foreground text-sm">
              {t('daemon.closeBehavior.label', 'Window Close Behavior')}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              {closeBehavior === 'keep-daemon'
                ? t(
                    'daemon.closeBehavior.keepDescription',
                    'Closing the window hides it to the system tray. The daemon keeps running and tasks continue in the background.',
                  )
                : t(
                    'daemon.closeBehavior.stopDescription',
                    'Closing the window stops the daemon and quits the app. Running tasks will be terminated.',
                  )}
            </p>
          </div>
          <div className="ml-4">
            <button
              role="switch"
              aria-checked={closeBehavior === 'keep-daemon'}
              onClick={handleCloseBehaviorChange}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                closeBehavior === 'keep-daemon' ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                  closeBehavior === 'keep-daemon' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        {closeBehavior === 'stop-daemon' && (
          <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-xs text-destructive">
              Background features (scheduled tasks, external integrations) will not work when the
              window is closed.
            </p>
          </div>
        )}
      </div>

      {/* Warning Dialog (Step 1) */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Background Mode?</DialogTitle>
            <DialogDescription>
              This will terminate any running tasks when you close the window. Background features
              like scheduled tasks and external integrations will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWarning(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleWarningConfirm}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog (Step 2) */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              Tasks in progress will be lost when you close the window. This is not recommended for
              most users.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleFinalConfirm}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
