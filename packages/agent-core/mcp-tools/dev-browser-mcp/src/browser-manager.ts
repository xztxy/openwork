import { type Browser, type Page } from 'playwright';

const RECOVERABLE_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'socket hang up',
  'net::ERR_',
  'WebSocket',
  'connection',
  'Target closed',
  'Session closed',
  'Browser closed',
];

export function isRecoverableConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RECOVERABLE_PATTERNS.some((p) => message.includes(p));
}

export class BrowserManager {
  private browser: Browser | null = null;
  private connectingPromise: Promise<Browser> | null = null;
  private readonly localPageRegistry = new Map<string, Page>();
  private cachedServerMode: string | null = null;

  getBrowser(): Browser | null {
    return this.browser;
  }
  setBrowser(browser: Browser): void {
    this.browser = browser;
  }
  getLocalPageRegistry(): Map<string, Page> {
    return this.localPageRegistry;
  }
  getCachedServerMode(): string | null {
    return this.cachedServerMode;
  }
  setCachedServerMode(mode: string): void {
    this.cachedServerMode = mode;
  }

  async ensureConnected(connect: () => Promise<Browser>): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;

    if (!this.connectingPromise) {
      this.connectingPromise = connect()
        .then((b) => {
          this.browser = b;
          return b;
        })
        .finally(() => {
          this.connectingPromise = null;
        });
    }

    return this.connectingPromise;
  }

  resetConnection(): void {
    this.browser = null;
    this.connectingPromise = null;
  }

  async withConnectionRecovery<T>(
    fn: () => Promise<T>,
    label: string,
    maxAttempts = 2,
    baseDelayMs = 100,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!isRecoverableConnectionError(error) || attempt >= maxAttempts - 1) throw error;
        this.resetConnection();
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        console.error(`[browser-manager] Retrying ${label} after connection error...`);
      }
    }
    throw lastError;
  }
}
