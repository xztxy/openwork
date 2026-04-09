/**
 * Context object passed to task lifecycle analytics events.
 * Identifies a specific task execution for event correlation.
 */
export interface TaskContext {
  taskId: string;
  sessionId: string;
  taskType: string;
}

/**
 * Standardized error categories for task failures.
 * Enables "workflow failure rate by category" dashboard metric.
 */
export type TaskErrorCategory =
  | 'auth_error'
  | 'rate_limit'
  | 'network_error'
  | 'tool_error'
  | 'timeout'
  | 'user_interrupted'
  | 'context_overflow'
  | 'provider_config'
  | 'unknown';
