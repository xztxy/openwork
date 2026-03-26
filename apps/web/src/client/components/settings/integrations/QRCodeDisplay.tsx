/**
 * QRCodeDisplay — real QR code with expiry countdown
 *
 * Contributed by kartikangiras (PR #455 feature/whatsapp).
 * Renders a standards-compliant SVG QR code from the pairing string using the
 * `qrcode` library, with an expiry timer and an "expired" overlay.
 */

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  qrString: string;
  expiresAt: number;
  onExpired?: () => void;
  size?: number;
}

export function QRCodeDisplay({ qrString, expiresAt, onExpired, size = 200 }: QRCodeDisplayProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [expired, setExpired] = useState(false);
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);

  // Generate real QR code SVG whenever the qrString changes
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(qrString, {
      type: 'image/png',
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) {
          setSvgDataUrl(url);
        }
      })
      .catch(() => {
        // Silently ignore — expired overlay will show if qrString is bad
      });
    return () => {
      cancelled = true;
    };
  }, [qrString, size]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) {
        setExpired(true);
        onExpired?.();
        if (interval) {
          clearInterval(interval);
        }
      }
    };
    tick(); // run immediately on mount to avoid 1s delay
    interval = setInterval(tick, 1000);
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [expiresAt, onExpired]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative rounded-xl border-2 border-border bg-white p-3 shadow-sm"
        style={{ width: size + 24, height: size + 24 }}
      >
        {expired ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center">
              <svg
                className="mx-auto h-8 w-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <p className="mt-2 text-xs text-muted-foreground">QR expired</p>
              <p className="text-xs text-muted-foreground">Refreshing…</p>
            </div>
          </div>
        ) : svgDataUrl ? (
          <img
            src={svgDataUrl}
            width={size}
            height={size}
            className="block"
            alt="WhatsApp QR code — scan with your phone"
            aria-label="WhatsApp QR code"
          />
        ) : (
          <div
            className="flex items-center justify-center"
            style={{ width: size, height: size }}
            aria-label="Generating QR code…"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
          </div>
        )}
      </div>

      {!expired && (
        <p className="text-xs text-muted-foreground">
          QR code expires in <span className="font-medium">{timeLeft}s</span>
        </p>
      )}
    </div>
  );
}
