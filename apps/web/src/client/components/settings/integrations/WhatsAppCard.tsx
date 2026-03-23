/**
 * WhatsAppCard — connection management UI for WhatsApp integration
 *
 * Contributed by aryan877 (PR #595 feat/whatsapp-integration).
 * - QR code display with countdown timer
 * - Connected / disconnected / reconnecting / logged-out states
 * - Confirm-before-disconnect UX pattern
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { QRCodeDisplay } from './QRCodeDisplay';

const QR_EXPIRY_SECONDS = 60;

interface WhatsAppState {
  status: string;
  phoneNumber?: string;
  lastConnectedAt?: number;
}

export function WhatsAppCard() {
  const accomplish = getAccomplish();

  const [config, setConfig] = useState<WhatsAppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number>(0);
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-clear confirm disconnect after 3 seconds
  useEffect(() => {
    if (!confirmDisconnect) {
      return;
    }
    const timer = setTimeout(() => setConfirmDisconnect(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDisconnect]);

  useEffect(() => {
    return () => {
      if (qrTimerRef.current) {
        clearInterval(qrTimerRef.current);
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
      }
    };
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const result = await accomplish.getWhatsAppConfig();
      if (result?.enabled) {
        setConfig({
          status: result.status,
          phoneNumber: result.phoneNumber,
          lastConnectedAt: result.lastConnectedAt,
        });
      } else {
        setConfig(null);
      }
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [accomplish]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    const unsubQR = accomplish.onWhatsAppQR((qr: string) => {
      setQrCode(qr);
      setQrExpiresAt(Date.now() + QR_EXPIRY_SECONDS * 1000);
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      setConnecting(false);
      setConfig((prev) => (prev ? { ...prev, status: 'qr_ready' } : { status: 'qr_ready' }));
    });

    const unsubStatus = accomplish.onWhatsAppStatus((status: string) => {
      setConfig((prev) => (prev ? { ...prev, status } : { status }));

      if (status === 'connected') {
        setQrCode(null);
        setConnecting(false);
        if (qrTimerRef.current) {
          clearInterval(qrTimerRef.current);
          qrTimerRef.current = null;
        }
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        fetchConfig();
      }
      if (status === 'disconnected' || status === 'logged_out') {
        setQrCode(null);
        setConnecting(false);
        if (qrTimerRef.current) {
          clearInterval(qrTimerRef.current);
          qrTimerRef.current = null;
        }
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      }
    });

    return () => {
      unsubQR();
      unsubStatus();
    };
  }, [accomplish, fetchConfig]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setQrCode(null);

    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
    }
    connectTimeoutRef.current = setTimeout(() => {
      setConnecting((prev) => {
        if (prev) {
          setError('Connection timed out. Please try again.');
        }
        return false;
      });
    }, 30_000);

    try {
      await accomplish.connectWhatsApp();
    } catch (err) {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setConnecting(false);
    }
  }, [accomplish]);

  const handleDisconnect = useCallback(async () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setDisconnecting(true);
    setConfirmDisconnect(false);
    try {
      await accomplish.disconnectWhatsApp();
      setConfig(null);
      setQrCode(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }, [confirmDisconnect, accomplish]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4" data-testid="whatsapp-card">
        <div className="flex items-center gap-3 mb-4 animate-pulse">
          <div className="h-9 w-9 rounded-lg bg-muted" />
          <div className="space-y-1.5">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-3 w-48 bg-muted rounded" />
          </div>
        </div>
        <div className="h-10 w-full rounded-md bg-muted" />
      </div>
    );
  }

  const isConnected = config?.status === 'connected';
  const isLoggedOut = config?.status === 'logged_out';
  const isQrReady = config?.status === 'qr_ready' && qrCode;
  const isConnecting = connecting || config?.status === 'connecting';

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4" data-testid="whatsapp-card">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">WhatsApp</h3>
          <p className="text-xs text-muted-foreground">Send and receive messages via WhatsApp</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Connected */}
      {isConnected && (
        <div className="space-y-3">
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-full bg-green-500/20 px-2 py-0.5 w-fit text-green-600 dark:text-green-400"
            data-testid="whatsapp-connection-status"
          >
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium">
              Connected{config?.phoneNumber ? ` (+${config.phoneNumber})` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            aria-label={
              confirmDisconnect ? 'Confirm disconnect from WhatsApp' : 'Disconnect from WhatsApp'
            }
            data-testid="whatsapp-disconnect-button"
            className={`w-full rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              confirmDisconnect
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : 'border-border hover:bg-muted'
            }`}
          >
            {(() => {
              if (disconnecting) {
                return 'Disconnecting…';
              }
              if (confirmDisconnect) {
                return 'Confirm Disconnect?';
              }
              return 'Disconnect';
            })()}
          </button>
        </div>
      )}

      {/* Logged out */}
      {isLoggedOut && (
        <div className="space-y-3">
          <div className="rounded-lg bg-destructive/10 p-3">
            <p className="text-xs text-destructive">
              Your WhatsApp session was logged out. Please reconnect to continue.
            </p>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isConnecting ? 'Connecting…' : 'Reconnect WhatsApp'}
          </button>
        </div>
      )}

      {/* QR ready */}
      {isQrReady && qrCode && (
        <div className="flex flex-col items-center gap-3 py-2 space-y-3">
          {/* QRCodeDisplay from kartikangiras (PR #455) */}
          <QRCodeDisplay
            qrString={qrCode}
            expiresAt={qrExpiresAt}
            onExpired={() => setQrCode(null)}
            size={200}
          />
          <p className="text-sm text-center text-muted-foreground">
            Open WhatsApp on your phone, go to <strong>Settings &gt; Linked Devices</strong>, and
            scan this code.
          </p>
        </div>
      )}

      {/* Disconnected (default) */}
      {!isConnected && !isLoggedOut && !isQrReady && (
        <div className="space-y-3">
          <div className="rounded-lg bg-yellow-500/10 p-3">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              ⚠️ This integration uses an unofficial WhatsApp Web protocol. Use at your own risk.
            </p>
          </div>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            data-testid="whatsapp-connect-button"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isConnecting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Connecting…
              </span>
            ) : (
              'Connect WhatsApp'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
