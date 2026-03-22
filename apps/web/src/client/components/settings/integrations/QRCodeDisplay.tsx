/**
 * QRCodeDisplay — visual QR code with expiry countdown
 *
 * Contributed by kartikangiras (PR #455 feature/whatsapp).
 * Renders a deterministic SVG QR pattern from the pairing string, with
 * an expiry timer and an "expired" overlay. Replaced by an actual QR library
 * once @whiskeysockets/baileys is bundled.
 */

import { useState, useEffect } from 'react';

interface QRCodeDisplayProps {
  qrString: string;
  expiresAt: number;
  onExpired?: () => void;
  size?: number;
}

/**
 * Generate a deterministic boolean grid from a string.
 * Uses a simple hash to produce a visually distinct pattern.
 */
function generateQRPattern(input: string, gridSize: number): boolean[][] {
  // Simple djb2-style hash for deterministic but varied patterns
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }

  const grid: boolean[][] = [];
  for (let row = 0; row < gridSize; row++) {
    const rowArr: boolean[] = [];
    for (let col = 0; col < gridSize; col++) {
      // Keep 3-cell finder patterns in corners
      const inTopLeft = row < 7 && col < 7;
      const inTopRight = row < 7 && col >= gridSize - 7;
      const inBottomLeft = row >= gridSize - 7 && col < 7;
      if (inTopLeft || inTopRight || inBottomLeft) {
        const localR = inTopLeft ? row : inTopRight ? row : row - (gridSize - 7);
        const localC = inTopLeft ? col : inTopRight ? col - (gridSize - 7) : col;
        const border = localR === 0 || localR === 6 || localC === 0 || localC === 6;
        const inner = localR >= 2 && localR <= 4 && localC >= 2 && localC <= 4;
        rowArr.push(border || inner);
      } else {
        const seed = (hash ^ (row * 31 + col * 17) * 2654435761) >>> 0;
        rowArr.push((seed % 100) < 55);
      }
    }
    grid.push(rowArr);
  }
  return grid;
}

export function QRCodeDisplay({ qrString, expiresAt, onExpired, size = 200 }: QRCodeDisplayProps) {
  const [timeLeft, setTimeLeft] = useState(
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  );
  const [expired, setExpired] = useState(timeLeft === 0);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0 && !expired) {
        setExpired(true);
        onExpired?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, expired, onExpired]);

  const cells = generateQRPattern(qrString, 25);

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
        ) : (
          <svg
            viewBox={`0 0 ${cells.length} ${cells.length}`}
            width={size}
            height={size}
            className="block"
            aria-label="WhatsApp QR code"
            role="img"
          >
            {cells.map((row, y) =>
              row.map((cell, x) =>
                cell ? (
                  <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000000" />
                ) : null,
              ),
            )}
            {/* Center logo area */}
            <rect
              x={Math.floor(cells.length / 2) - 3}
              y={Math.floor(cells.length / 2) - 3}
              width={7}
              height={7}
              fill="#ffffff"
              rx={1}
            />
            <rect
              x={Math.floor(cells.length / 2) - 2}
              y={Math.floor(cells.length / 2) - 2}
              width={5}
              height={5}
              fill="#25D366"
              rx={1}
            />
          </svg>
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
