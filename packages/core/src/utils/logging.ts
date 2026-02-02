/**
 * Basic logging utilities for @accomplish/core
 *
 * Provides a simple, extensible logging interface that can be used
 * across the core package without depending on specific logging frameworks.
 */

/**
 * Log severity levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A log entry with metadata
 */
export interface LogEntry {
  /** Log severity level */
  level: LogLevel;
  /** The log message */
  message: string;
  /** Timestamp of the log entry */
  timestamp: Date;
  /** Optional context data */
  context?: Record<string, unknown>;
}

/**
 * Logger interface for consistent logging across the package
 */
export interface Logger {
  /**
   * Log a debug message
   * @param message - The message to log
   * @param context - Optional context data
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an info message
   * @param message - The message to log
   * @param context - Optional context data
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log a warning message
   * @param message - The message to log
   * @param context - Optional context data
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an error message
   * @param message - The message to log
   * @param context - Optional context data
   */
  error(message: string, context?: Record<string, unknown>): void;

  /**
   * Create a child logger with a specific prefix
   * @param childPrefix - The prefix for the child logger
   * @returns A new logger instance with the prefix
   */
  child(childPrefix: string): Logger;
}

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Console logger options
 */
export interface ConsoleLoggerOptions {
  /** Prefix to prepend to all log messages */
  prefix?: string;
  /** Minimum log level to output (default: 'debug') */
  minLevel?: LogLevel;
  /** Whether to include timestamps (default: true) */
  includeTimestamp?: boolean;
}

/**
 * Create a simple console-based logger
 *
 * @param options - Logger configuration options
 * @returns A Logger instance that outputs to the console
 */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const { prefix = '', minLevel = 'debug', includeTimestamp = true } = options;

  const formatMessage = (level: LogLevel, message: string): string => {
    const parts: string[] = [];

    if (includeTimestamp) {
      parts.push(new Date().toISOString());
    }

    parts.push(`[${level.toUpperCase()}]`);

    if (prefix) {
      parts.push(`[${prefix}]`);
    }

    parts.push(message);

    return parts.join(' ');
  };

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
  };

  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (!shouldLog(level)) {
      return;
    }

    const formattedMessage = formatMessage(level, message);
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (context && Object.keys(context).length > 0) {
      consoleFn(formattedMessage, context);
    } else {
      consoleFn(formattedMessage);
    }
  };

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
    child: (childPrefix) =>
      createConsoleLogger({
        ...options,
        prefix: prefix ? `${prefix}:${childPrefix}` : childPrefix,
      }),
  };
}

/**
 * Create a no-op logger that discards all log messages
 *
 * Useful for tests or when logging needs to be disabled
 *
 * @returns A Logger instance that does nothing
 */
export function createNoOpLogger(): Logger {
  const noop = (): void => {
    // Intentionally empty
  };

  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => createNoOpLogger(),
  };
}

/**
 * Create a buffered logger that stores log entries in memory
 *
 * Useful for testing or when log entries need to be processed later
 *
 * @param options - Logger configuration options
 * @returns A Logger instance with a getEntries() method
 */
export function createBufferedLogger(
  options: ConsoleLoggerOptions = {}
): Logger & { getEntries(): LogEntry[]; clear(): void } {
  const { prefix = '', minLevel = 'debug' } = options;
  const entries: LogEntry[] = [];

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
  };

  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (!shouldLog(level)) {
      return;
    }

    const fullMessage = prefix ? `[${prefix}] ${message}` : message;

    entries.push({
      level,
      message: fullMessage,
      timestamp: new Date(),
      context,
    });
  };

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
    child: (childPrefix) =>
      createBufferedLogger({
        ...options,
        prefix: prefix ? `${prefix}:${childPrefix}` : childPrefix,
      }),
    getEntries: () => [...entries],
    clear: () => {
      entries.length = 0;
    },
  };
}
