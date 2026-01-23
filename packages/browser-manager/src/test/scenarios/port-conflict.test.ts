// packages/browser-manager/src/test/scenarios/port-conflict.test.ts
import { describe, it, expect } from 'vitest';
import { BrowserManager } from '../../manager.js';
import { PortExhaustedError } from '../../port-finder.js';
import http from 'http';

describe('Port Conflict Scenarios', () => {
  it('switches to next port when first is occupied', async () => {
    // Create a dummy server on port 59800
    const server = http.createServer((_, res) => {
      res.writeHead(200);
      res.end('not our server');
    });

    await new Promise<void>((resolve) => {
      server.listen(59800, resolve);
    });

    try {
      const manager = new BrowserManager({
        portRangeStart: 59800,
        portRangeEnd: 59810,
      });

      // The manager should skip 59800 and use 59802
      // (This is a unit test, actual acquire would need browser)
      const { findAvailablePorts } = await import('../../port-finder.js');
      const ports = await findAvailablePorts({
        portRangeStart: 59800,
        portRangeEnd: 59810,
      });

      // Port 59800 is taken, should get 59802
      expect(ports.http).toBe(59802);
      expect(ports.cdp).toBe(59803);
    } finally {
      server.close();
    }
  });

  it('throws PortExhaustedError when all ports taken', async () => {
    // Create servers on all ports in a tiny range
    const servers: http.Server[] = [];

    for (let port = 59850; port <= 59854; port += 2) {
      const server = http.createServer((_, res) => {
        res.writeHead(200);
        res.end('taken');
      });
      await new Promise<void>((resolve) => {
        server.listen(port, resolve);
      });
      servers.push(server);
    }

    try {
      const { findAvailablePorts } = await import('../../port-finder.js');
      await expect(
        findAvailablePorts({
          portRangeStart: 59850,
          portRangeEnd: 59854,
        })
      ).rejects.toThrow(PortExhaustedError);
    } finally {
      for (const server of servers) {
        server.close();
      }
    }
  });
});
