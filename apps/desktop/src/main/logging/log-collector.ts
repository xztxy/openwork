/**
 * Electron-specific LogCollector wrapper.
 *
 * This thin wrapper creates a LogCollector instance using the Electron-specific
 * LogFileWriter that injects the correct userData path.
 */

import { LogCollector } from '@accomplish/core';
import { getLogFileWriter, shutdownLogFileWriter } from './log-file-writer';

// Re-export types from shared package for backward compatibility
export type { LogLevel, LogSource } from '@accomplish/shared';

let instance: LogCollector | null = null;

export function getLogCollector(): LogCollector {
  if (!instance) {
    instance = new LogCollector(getLogFileWriter());
  }
  return instance;
}

export function initializeLogCollector(): void {
  getLogCollector().initialize();
}

export function shutdownLogCollector(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
  // Also shutdown the file writer
  shutdownLogFileWriter();
}
