import type { TodoItem } from '../../common/types/todo.js';
import { getDatabase } from '../database.js';

interface TodoRow {
  id: number;
  task_id: string;
  todo_id: string;
  content: string;
  status: string;
  priority: string;
  sort_order: number;
}

export function getTodosForTask(taskId: string): TodoItem[] {
  const db = getDatabase();

  const rows = db
    .prepare('SELECT * FROM task_todos WHERE task_id = ? ORDER BY sort_order ASC')
    .all(taskId) as TodoRow[];

  return rows.map((row) => ({
    id: row.todo_id,
    content: row.content,
    status: row.status as TodoItem['status'],
    priority: row.priority as TodoItem['priority'],
  }));
}

export function saveTodosForTask(taskId: string, todos: TodoItem[]): void {
  const db = getDatabase();

  db.transaction(() => {
    db.prepare('DELETE FROM task_todos WHERE task_id = ?').run(taskId);

    const insert = db.prepare(
      `INSERT INTO task_todos (task_id, todo_id, content, status, priority, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    todos.forEach((todo, index) => {
      insert.run(taskId, todo.id, todo.content, todo.status, todo.priority, index);
    });
  })();
}

export function clearTodosForTask(taskId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM task_todos WHERE task_id = ?').run(taskId);
}
