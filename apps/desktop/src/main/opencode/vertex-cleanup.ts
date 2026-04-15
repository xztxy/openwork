import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLogCollector } from '../logging';

export const VERTEX_SA_KEY_FILENAME = 'vertex-sa-key.json';

function logOC(level: 'INFO' | 'WARN', msg: string, data?: Record<string, unknown>) {
  try {
    const l = getLogCollector();
    if (l?.log) {
      l.log(level, 'opencode', msg, data);
    }
  } catch (_e) {
    /* best-effort logging */
  }
}

/**
 * Removes the Vertex AI service account key file from disk if it exists.
 * Called when the Vertex provider is disconnected or the app quits.
 *
 * Phase 4b of the OpenCode SDK cutover port: extracted from the deleted
 * `environment-builder.ts` (which only existed to feed the dead PTY-era
 * desktop-side `buildEnvironment`). The key file itself is still written
 * by the daemon's environment builder when Vertex is configured.
 */
export function cleanupVertexServiceAccountKey(): void {
  try {
    const keyPath = path.join(app.getPath('userData'), VERTEX_SA_KEY_FILENAME);
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
      logOC('INFO', '[Vertex] Cleaned up service account key file');
    }
  } catch (error) {
    logOC('WARN', '[Vertex] Failed to clean up service account key file', { error: String(error) });
  }
}
