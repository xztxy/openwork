import type { PortPair, BrowserManagerConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

export type PortStatus = 'free' | 'ours_healthy' | 'ours_stale' | 'external';

/**
 * Check if a port pair is available or has our server running
 */
export async function checkPortStatus(httpPort: number, cdpPort: number): Promise<PortStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    const res = await fetch(`http://localhost:${httpPort}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return 'external'; // Something responded but not OK
    }

    // Check if it's our server by looking for wsEndpoint in response
    const data = await res.json() as { wsEndpoint?: string; mode?: string };
    if (!data.wsEndpoint) {
      return 'external'; // Not our server format
    }

    // It's our server, now check if browser is actually healthy
    // by verifying CDP endpoint responds
    try {
      const cdpController = new AbortController();
      const cdpTimeout = setTimeout(() => cdpController.abort(), 1000);

      const cdpRes = await fetch(`http://localhost:${cdpPort}/json/version`, {
        signal: cdpController.signal,
      });
      clearTimeout(cdpTimeout);

      if (cdpRes.ok) {
        return 'ours_healthy';
      }
      return 'ours_stale';
    } catch {
      return 'ours_stale';
    }
  } catch {
    // Fetch failed - port is free
    return 'free';
  }
}

/**
 * Find available HTTP/CDP port pair by scanning range
 * Never kills processes - just finds free ports
 */
export async function findAvailablePorts(
  config: Pick<BrowserManagerConfig, 'portRangeStart' | 'portRangeEnd'> = {}
): Promise<PortPair> {
  const start = config.portRangeStart ?? DEFAULT_CONFIG.portRangeStart;
  const end = config.portRangeEnd ?? DEFAULT_CONFIG.portRangeEnd;
  const triedPorts: number[] = [];

  for (let http = start; http <= end; http += 2) {
    const cdp = http + 1;
    triedPorts.push(http);

    const status = await checkPortStatus(http, cdp);

    if (status === 'free') {
      return { http, cdp };
    }

    if (status === 'ours_healthy') {
      return { http, cdp }; // Reuse existing healthy server
    }

    // ours_stale or external - try next port pair
  }

  throw new PortExhaustedError(triedPorts);
}

export class PortExhaustedError extends Error {
  readonly triedPorts: number[];

  constructor(triedPorts: number[]) {
    super(`All ports exhausted. Tried: ${triedPorts.join(', ')}`);
    this.name = 'PortExhaustedError';
    this.triedPorts = triedPorts;
  }
}
