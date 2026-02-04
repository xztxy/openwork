import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { redact } from '@accomplish/core';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const RETENTION_DAYS = 7;
const BUFFER_FLUSH_INTERVAL_MS = 5000;
const BUFFER_MAX_ENTRIES = 100;

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type LogSource = 'main' | 'mcp' | 'browser' | 'opencode' | 'env' | 'ipc';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
}

class LogFileWriter {
  private logDir: string;
  private currentDate: string = '';
  private currentFilePath: string = '';
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private fileSizeExceeded: boolean = false;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.logDir = path.join(userDataPath, 'logs');
  }

  initialize(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.cleanupOldLogs();
    this.updateCurrentFile();
    this.flushTimer = setInterval(() => this.flush(), BUFFER_FLUSH_INTERVAL_MS);
  }

  write(level: LogLevel, source: LogSource, message: string): void {
    if (this.fileSizeExceeded) {
      const today = new Date().toISOString().split('T')[0];
      if (today !== this.currentDate) {
        this.currentDate = today;
        this.currentFilePath = path.join(this.logDir, `app-${today}.log`);
        this.fileSizeExceeded = false;
      } else {
        return;
      }
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message: redact(message),
    };

    this.buffer.push(entry);

    if (this.buffer.length >= BUFFER_MAX_ENTRIES) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;

    this.updateCurrentFile();

    if (this.checkFileSize()) {
      this.fileSizeExceeded = true;
      console.error('[LogFileWriter] Max file size exceeded, stopping writes');
      return;
    }

    const lines = this.buffer.map((entry) =>
      `[${entry.timestamp}] [${entry.level}] [${entry.source}] ${entry.message}`
    );

    try {
      fs.appendFileSync(this.currentFilePath, lines.join('\n') + '\n');
      this.buffer = [];
    } catch (error) {
      console.error('[LogFileWriter] Failed to write logs:', error);
      // Don't clear buffer on failure - retry on next flush, but prevent unbounded growth
      if (this.buffer.length > BUFFER_MAX_ENTRIES * 10) {
        console.error('[LogFileWriter] Buffer overflow - dropping oldest entries');
        this.buffer = this.buffer.slice(-BUFFER_MAX_ENTRIES);
      }
    }
  }

  getCurrentLogPath(): string {
    this.updateCurrentFile();
    return this.currentFilePath;
  }

  getLogDir(): string {
    return this.logDir;
  }

  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private updateCurrentFile(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.currentDate) {
      // Write buffered entries to old file directly to avoid recursion from calling flush()
      if (this.currentDate && this.buffer.length > 0 && this.currentFilePath) {
        const lines = this.buffer.map((entry) =>
          `[${entry.timestamp}] [${entry.level}] [${entry.source}] ${entry.message}`
        );
        try {
          fs.appendFileSync(this.currentFilePath, lines.join('\n') + '\n');
          this.buffer = [];
        } catch (error) {
          console.error('[LogFileWriter] Failed to write logs on date change:', error);
          // Don't clear buffer - entries will be written to new file
        }
      }
      this.currentDate = today;
      this.currentFilePath = path.join(this.logDir, `app-${today}.log`);
      this.fileSizeExceeded = false;
    }
  }

  private checkFileSize(): boolean {
    try {
      if (!fs.existsSync(this.currentFilePath)) return false;
      const stats = fs.statSync(this.currentFilePath);
      return stats.size >= MAX_FILE_SIZE_BYTES;
    } catch {
      return false;
    }
  }

  private cleanupOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

      for (const file of files) {
        if (!file.startsWith('app-') || !file.endsWith('.log')) continue;

        const dateMatch = file.match(/app-(\d{4}-\d{2}-\d{2})\.log/);
        if (!dateMatch) continue;

        const fileDate = new Date(dateMatch[1]);
        if (fileDate < cutoffDate) {
          const filePath = path.join(this.logDir, file);
          fs.unlinkSync(filePath);
          console.log(`[LogFileWriter] Deleted old log file: ${file}`);
        }
      }
    } catch (error) {
      console.error('[LogFileWriter] Failed to cleanup old logs:', error);
    }
  }
}

let instance: LogFileWriter | null = null;

export function getLogFileWriter(): LogFileWriter {
  if (!instance) {
    instance = new LogFileWriter();
  }
  return instance;
}

export function initializeLogFileWriter(): void {
  getLogFileWriter().initialize();
}

export function shutdownLogFileWriter(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}
