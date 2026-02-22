import { resetConnection } from './connection.js';

const TRANSPORT_ERROR_PATTERNS = [
  'fetch failed',
  'ECONNREFUSED',
  'ECONNRESET',
  'socket hang up',
  'UND_ERR',
];

export function isTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSPORT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

const RECOVERY_COOLDOWN_MS = 10_000;
const POLL_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 1250;

let lastRecoveryTimestamp = 0;

export async function attemptRecovery(serverUrl: string): Promise<boolean> {
  const now = Date.now();
  if (now - lastRecoveryTimestamp < RECOVERY_COOLDOWN_MS) {
    return false;
  }
  lastRecoveryTimestamp = now;

  resetConnection();

  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    try {
      const res = await fetch(serverUrl);
      if (res.ok) {
        return true;
      }
    } catch {
      // server not ready yet
    }
    if (i < POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  return false;
}

export function _resetRecoveryState(): void {
  lastRecoveryTimestamp = 0;
}
