import type { TaskMessage, TaskStatus, TaskAttachment } from '../../common/types/task.js';
import { getDatabase } from '../database.js';

export interface StoredTask {
  id: string;
  prompt: string;
  summary?: string;
  status: TaskStatus;
  messages: TaskMessage[];
  sessionId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskRow {
  id: string;
  prompt: string;
  summary: string | null;
  status: string;
  session_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface MessageRow {
  id: string;
  task_id: string;
  type: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  timestamp: string;
  sort_order: number;
}

export interface AttachmentRow {
  id: number;
  message_id: string;
  type: string;
  data: string;
  label: string | null;
}

export function getMessagesForTask(taskId: string): TaskMessage[] {
  const db = getDatabase();

  const messageRows = db
    .prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY sort_order ASC')
    .all(taskId) as MessageRow[];

  const messages: TaskMessage[] = [];

  for (const row of messageRows) {
    const attachmentRows = db
      .prepare('SELECT * FROM task_attachments WHERE message_id = ?')
      .all(row.id) as AttachmentRow[];

    const attachments: TaskAttachment[] | undefined =
      attachmentRows.length > 0
        ? attachmentRows.map((a) => ({
            type: a.type as 'screenshot' | 'json',
            data: a.data,
            label: a.label || undefined,
          }))
        : undefined;

    messages.push({
      id: row.id,
      type: row.type as TaskMessage['type'],
      content: row.content,
      toolName: row.tool_name || undefined,
      toolInput: row.tool_input ? JSON.parse(row.tool_input) : undefined,
      timestamp: row.timestamp,
      attachments,
    });
  }

  return messages;
}

export function rowToTask(row: TaskRow): StoredTask {
  return {
    id: row.id,
    prompt: row.prompt,
    summary: row.summary || undefined,
    status: row.status as TaskStatus,
    sessionId: row.session_id || undefined,
    createdAt: row.created_at,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    messages: getMessagesForTask(row.id),
  };
}
