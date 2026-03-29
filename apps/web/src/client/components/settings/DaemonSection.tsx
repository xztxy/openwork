/**
 * DaemonSection — Settings UI for daemon monitoring and control.
 *
 * Merged from the standalone DaemonPanel. Includes:
 * - Status monitor (running/stopped/reconnecting) with uptime and last ping
 * - Control buttons (start/stop/restart)
 * - Close-button behavior setting with double confirmation
 * - Socket path display with copy button
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
  const [socketPath, setSocketPath] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll daemon status
  const pollStatus = useCallback(async () => {
    try {
      const result = await accomplish.daemonPing();
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

  // Load settings
  useEffect(() => {
    accomplish
      .getCloseBehavior()
      .then(setCloseBehavior)
      .catch(() => {});
    accomplish
      .getDaemonSocketPath()
      .then(setSocketPath)
      .catch(() => {});
  }, [accomplish]);

  // Listen for daemon connection events (disconnected/reconnected)
  useEffect(() => {
    const unsubDisconnect = accomplish.onDaemonDisconnected(() => {
      setStatus('reconnecting');
    });
    const unsubReconnect = accomplish.onDaemonReconnected(() => {
      void pollStatus();
    });
    return () => {
      unsubDisconnect();
      unsubReconnect();
    };
  }, [accomplish, pollStatus]);

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
      setShowWarning(true);
    } else {
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

  const statusLabel = t(`daemon.status.${status}`, status);

  return (
    <>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
        {t('daemon.title')}
      </h4>

      {/* Status Monitor */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
            <div>
              <div className="font-medium text-foreground text-sm">{statusLabel}</div>
              {status === 'running' && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('daemon.status.uptime', { uptime: formatUptime(uptime) })}
                  {lastPing && (
                    <span className="ml-2">
                      ·{' '}
                      {t('daemon.status.lastPing', {
                        seconds: Math.round((Date.now() - lastPing.getTime()) / 1000),
                      })}
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
                  {actionInProgress === 'restart'
                    ? t('daemon.controls.restarting')
                    : t('daemon.controls.restart')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStop}
                  disabled={actionInProgress !== null}
                >
                  {actionInProgress === 'stop'
                    ? t('daemon.controls.stopping')
                    : t('daemon.controls.stop')}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStart}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === 'start'
                  ? t('daemon.controls.starting')
                  : t('daemon.controls.start')}
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
              {t('daemon.closeBehavior.label')}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              {closeBehavior === 'keep-daemon'
                ? t('daemon.closeBehavior.keepDescription')
                : t('daemon.closeBehavior.stopDescription')}
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
            <p className="text-xs text-destructive">{t('daemon.closeBehavior.warning')}</p>
          </div>
        )}
      </div>

      {/* Socket Path */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="font-medium text-foreground text-sm">{t('daemon.socket.title')}</div>
        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
          {t('daemon.socket.description')}
        </p>

        {socketPath ? (
          <div className="mt-3">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t('daemon.socket.pathLabel')}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 rounded-md bg-muted px-3 py-2 text-xs font-mono text-foreground break-all overflow-hidden text-ellipsis">
                {socketPath}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(socketPath).catch(() => {});
                }}
                className="flex-shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title={t('daemon.socket.copy')}
              >
                {t('daemon.socket.copy')}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground italic">
            {t('daemon.socket.pathUnavailable')}
          </p>
        )}
      </div>

      {/* Warning Dialog (Step 1) */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('daemon.warningDialog.title')}</DialogTitle>
            <DialogDescription>{t('daemon.warningDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWarning(false)}>
              {t('daemon.warningDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleWarningConfirm}>
              {t('daemon.warningDialog.continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog (Step 2) */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('daemon.confirmDialog.title')}</DialogTitle>
            <DialogDescription>{t('daemon.confirmDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              {t('daemon.confirmDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleFinalConfirm}>
              {t('daemon.confirmDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
