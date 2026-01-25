# Todo Breakdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface OpenCode's todowrite tool in the UI with a sidebar checklist and enforce completion of all todos before task finishes.

**Architecture:** Detect todowrite tool calls in the adapter, emit todo:update events through IPC, display in Zustand-backed React components, and extend CompletionEnforcer to block completion when todos are incomplete.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, Framer Motion

---

## Task 1: Add TodoItem Type

**Files:**
- Create: `packages/shared/src/types/todo.ts`
- Modify: `packages/shared/src/types/index.ts`

**Step 1: Create the todo types file**

```typescript
// packages/shared/src/types/todo.ts
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}
```

**Step 2: Export from index**

Add to `packages/shared/src/types/index.ts`:
```typescript
export * from './todo';
```

**Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/shared/src/types/todo.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add TodoItem type for task breakdown"
```

---

## Task 2: Add todo:update Event to Adapter

**Files:**
- Modify: `apps/desktop/src/main/opencode/adapter.ts`

**Step 1: Import TodoItem type**

Add import at top of adapter.ts:
```typescript
import type { TodoItem } from '@accomplish/shared';
```

**Step 2: Add event to OpenCodeAdapterEvents interface**

Find `export interface OpenCodeAdapterEvents` (around line 60) and add:
```typescript
'todo:update': [TodoItem[]];
```

**Step 3: Detect todowrite tool calls in setupStreamParsing**

Find the method `setupStreamParsing` and locate where tool_use messages are handled. Add detection after existing tool handling:

```typescript
// Detect todowrite tool calls and emit todo state
if (msg.type === 'tool_use' && msg.part.tool === 'todowrite') {
  const input = msg.part.state.input as { todos?: TodoItem[] };
  if (input?.todos && Array.isArray(input.todos)) {
    this.emit('todo:update', input.todos);
    // Also update completion enforcer
    this.completionEnforcer.updateTodos(input.todos);
  }
}
```

**Step 4: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: Will fail because CompletionEnforcer doesn't have updateTodos yet - that's Task 5

**Step 5: Commit (partial - will complete after Task 5)**

Don't commit yet - the completionEnforcer.updateTodos call will fail typecheck until Task 5.

---

## Task 3: Add IPC Handler for todo:update

**Files:**
- Modify: `apps/desktop/src/main/ipc/handlers.ts`

**Step 1: Find setupTaskCallbacks function**

Locate where other adapter events are forwarded (around line 129-206).

**Step 2: Add todo:update handler**

Add after other adapter.on handlers:
```typescript
adapter.on('todo:update', (todos) => {
  forwardToRenderer('todo:update', { taskId, todos });
});
```

**Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (this file doesn't import TodoItem, it just forwards the data)

**Step 4: Commit**

```bash
git add apps/desktop/src/main/ipc/handlers.ts
git commit -m "feat(ipc): forward todo:update events to renderer"
```

---

## Task 4: Expose todo:update in Preload

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

**Step 1: Add onTodoUpdate to accomplishAPI**

Find the event subscriptions section (around line 187) and add:

```typescript
// Todo updates from OpenCode todowrite tool
onTodoUpdate: (callback: (data: { taskId: string; todos: Array<{ id: string; content: string; status: string; priority: string }> }) => void) => {
  const listener = (_: unknown, data: { taskId: string; todos: Array<{ id: string; content: string; status: string; priority: string }> }) => callback(data);
  ipcRenderer.on('todo:update', listener);
  return () => ipcRenderer.removeListener('todo:update', listener);
},
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/preload/index.ts
git commit -m "feat(preload): expose onTodoUpdate for todo tracking"
```

---

## Task 5: Add Todo State to CompletionEnforcer

**Files:**
- Modify: `apps/desktop/src/main/opencode/completion/completion-enforcer.ts`
- Modify: `apps/desktop/src/main/opencode/completion/prompts.ts`

**Step 1: Import TodoItem type**

Add at top of completion-enforcer.ts:
```typescript
import type { TodoItem } from '@accomplish/shared';
```

**Step 2: Add todo tracking state and methods to CompletionEnforcer class**

After `private callbacks: CompletionEnforcerCallbacks;` add:
```typescript
private currentTodos: TodoItem[] = [];
```

Add public method after constructor:
```typescript
/**
 * Update current todos from todowrite tool.
 */
updateTodos(todos: TodoItem[]): void {
  this.currentTodos = todos;
  this.callbacks.onDebug(
    'todo_update',
    `Todo list updated: ${todos.length} items`,
    { todos }
  );
}
```

Add private helper methods:
```typescript
private hasIncompleteTodos(): boolean {
  return this.currentTodos.some(
    t => t.status === 'pending' || t.status === 'in_progress'
  );
}

private getIncompleteTodosSummary(): string {
  const incomplete = this.currentTodos.filter(
    t => t.status === 'pending' || t.status === 'in_progress'
  );
  return incomplete.map(t => `- ${t.content}`).join('\n');
}
```

**Step 3: Modify handleCompleteTaskDetection to check todos**

In `handleCompleteTaskDetection`, after recording the complete_task call, add check:
```typescript
// If claiming success but have incomplete todos, treat as needing continuation
if (completeTaskArgs.status === 'success' && this.hasIncompleteTodos()) {
  this.callbacks.onDebug(
    'incomplete_todos',
    'Agent claimed success but has incomplete todos',
    { incompleteTodos: this.getIncompleteTodosSummary() }
  );
  // Override to trigger continuation
  completeTaskArgs.remaining_work = this.getIncompleteTodosSummary();
}
```

**Step 4: Add continuation prompt for incomplete todos**

In `prompts.ts`, add new prompt function:
```typescript
export function getIncompleteTodosPrompt(incompleteTodos: string): string {
  return `You marked the task complete but have incomplete todos:

${incompleteTodos}

Either complete these items or update the todo list to mark them as cancelled if no longer needed. Then call complete_task again.`;
}
```

**Step 5: Clear todos on reset**

In the `reset()` method, add:
```typescript
this.currentTodos = [];
```

**Step 6: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/main/opencode/completion/completion-enforcer.ts apps/desktop/src/main/opencode/completion/prompts.ts
git commit -m "feat(completion): enforce todo completion before task success"
```

---

## Task 6: Complete Adapter Todo Integration

**Files:**
- Modify: `apps/desktop/src/main/opencode/adapter.ts`

**Step 1: Verify the code from Task 2 now typechecks**

The `this.completionEnforcer.updateTodos(input.todos)` call should now work.

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit adapter changes**

```bash
git add apps/desktop/src/main/opencode/adapter.ts
git commit -m "feat(adapter): detect todowrite and emit todo:update events"
```

---

## Task 7: Add Todos to Zustand Store

**Files:**
- Modify: `apps/desktop/src/renderer/stores/taskStore.ts`

**Step 1: Import TodoItem type**

Add to imports:
```typescript
import type { TodoItem } from '@accomplish/shared';
```

**Step 2: Add todos state to TaskState interface**

After `startupStageTaskId: string | null;` add:
```typescript
// Todo tracking
todos: TodoItem[];
todosTaskId: string | null;
```

**Step 3: Add actions to TaskState interface**

After `reset: () => void;` add:
```typescript
setTodos: (taskId: string, todos: TodoItem[]) => void;
clearTodos: () => void;
```

**Step 4: Add initial state values**

After `startupStageTaskId: null,` add:
```typescript
todos: [],
todosTaskId: null,
```

**Step 5: Add action implementations**

Before `openLauncher:` add:
```typescript
setTodos: (taskId: string, todos: TodoItem[]) => {
  set({ todos, todosTaskId: taskId });
},

clearTodos: () => {
  set({ todos: [], todosTaskId: null });
},
```

**Step 6: Clear todos in reset()**

Add to reset action:
```typescript
todos: [],
todosTaskId: null,
```

**Step 7: Add todo:update subscription**

At bottom of file, in the `if (typeof window !== 'undefined' && window.accomplish)` block, add:

```typescript
// Subscribe to todo updates
window.accomplish.onTodoUpdate?.((data: { taskId: string; todos: TodoItem[] }) => {
  useTaskStore.getState().setTodos(data.taskId, data.todos);
});
```

**Step 8: Clear todos on task complete**

In the existing onTaskUpdate subscription where complete/error is handled, add:
```typescript
state.clearTodos();
```

**Step 9: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 10: Commit**

```bash
git add apps/desktop/src/renderer/stores/taskStore.ts
git commit -m "feat(store): add todos state and actions"
```

---

## Task 8: Create TodoSidebar Component

**Files:**
- Create: `apps/desktop/src/renderer/components/TodoSidebar.tsx`

**Step 1: Create the component file**

```typescript
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TodoItem } from '@accomplish/shared';

interface TodoSidebarProps {
  todos: TodoItem[];
}

export function TodoSidebar({ todos }: TodoSidebarProps) {
  if (todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const cancelled = todos.filter(t => t.status === 'cancelled').length;
  const total = todos.length;
  const progress = ((completed + cancelled) / total) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="w-[250px] border-l border-border bg-card/50 flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Tasks</span>
          <span className="text-xs text-muted-foreground">
            {completed} of {total}
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1">
          {todos.map((todo) => (
            <TodoListItem key={todo.id} todo={todo} />
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

function TodoListItem({ todo }: { todo: TodoItem }) {
  const priorityBorder = {
    high: 'border-l-red-500',
    medium: 'border-l-amber-500',
    low: 'border-l-blue-500',
  }[todo.priority];

  return (
    <li
      className={cn(
        'flex items-start gap-2 px-2 py-1.5 rounded-md border-l-2',
        priorityBorder,
        todo.status === 'cancelled' && 'opacity-50'
      )}
    >
      <StatusIcon status={todo.status} />
      <span
        className={cn(
          'text-xs text-foreground leading-snug',
          todo.status === 'cancelled' && 'line-through text-muted-foreground'
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
    case 'in_progress':
      return <Loader2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5 animate-spin" />;
    case 'cancelled':
      return <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />;
    case 'pending':
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />;
  }
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/TodoSidebar.tsx
git commit -m "feat(ui): add TodoSidebar component"
```

---

## Task 9: Create TodoInlineCard Component

**Files:**
- Create: `apps/desktop/src/renderer/components/TodoInlineCard.tsx`

**Step 1: Create the component file**

```typescript
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TodoItem } from '@accomplish/shared';

interface TodoInlineCardProps {
  todos: TodoItem[];
}

export function TodoInlineCard({ todos }: TodoInlineCardProps) {
  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Task Breakdown
        </span>
        <span className="text-xs text-muted-foreground">
          {completed}/{total}
        </span>
      </div>
      <ul className="space-y-1">
        {todos.map((todo) => (
          <li key={todo.id} className="flex items-start gap-2">
            <InlineStatusIcon status={todo.status} />
            <span
              className={cn(
                'text-xs text-foreground',
                todo.status === 'cancelled' && 'line-through text-muted-foreground'
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InlineStatusIcon({ status }: { status: TodoItem['status'] }) {
  const iconClass = 'h-3 w-3 shrink-0 mt-0.5';
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={cn(iconClass, 'text-green-500')} />;
    case 'in_progress':
      return <Loader2 className={cn(iconClass, 'text-primary animate-spin')} />;
    case 'cancelled':
      return <XCircle className={cn(iconClass, 'text-muted-foreground')} />;
    case 'pending':
    default:
      return <Circle className={cn(iconClass, 'text-muted-foreground')} />;
  }
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/TodoInlineCard.tsx
git commit -m "feat(ui): add TodoInlineCard for inline todo rendering"
```

---

## Task 10: Integrate Components into Execution Page

**Files:**
- Modify: `apps/desktop/src/renderer/pages/Execution.tsx`

**Step 1: Import new components and TodoItem type**

Add imports:
```typescript
import { TodoSidebar } from '../components/TodoSidebar';
import { TodoInlineCard } from '../components/TodoInlineCard';
import type { TodoItem } from '@accomplish/shared';
```

**Step 2: Get todos from store**

In the destructured useTaskStore call, add:
```typescript
todos,
todosTaskId,
```

**Step 3: Modify layout to include sidebar**

Find the main container div that holds the messages. The current structure is:
```tsx
<div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollContainerRef} ...>
```

Wrap this and add sidebar. Change the messages area to be a flex container:

Find this structure (around line 649-755):
```tsx
{/* Messages - normal state (running, completed, failed, etc.) */}
{currentTask.status !== 'queued' && (
  <div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollContainerRef} onScroll={handleScroll} data-testid="messages-scroll-container">
```

Replace with:
```tsx
{/* Messages - normal state (running, completed, failed, etc.) */}
{currentTask.status !== 'queued' && (
  <div className="flex-1 flex overflow-hidden">
    {/* Messages area */}
    <div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollContainerRef} onScroll={handleScroll} data-testid="messages-scroll-container">
      {/* ... existing messages content ... */}
    </div>

    {/* Todo sidebar - only shown when todos exist for this task */}
    <AnimatePresence>
      {todosTaskId === id && todos.length > 0 && (
        <TodoSidebar todos={todos} />
      )}
    </AnimatePresence>
  </div>
)}
```

**Step 4: Render TodoInlineCard for todowrite messages**

In the MessageBubble component or where tool messages are rendered, check for todowrite:

Find in MessageBubble where tool messages are rendered (around line 1317):
```tsx
{isTool ? (
  <>
    <div className="flex items-center gap-2 ...">
```

Add before the existing isTool rendering:
```tsx
{isTool && message.toolName === 'todowrite' ? (
  <TodoInlineCard todos={(message.toolInput as { todos?: TodoItem[] })?.todos || []} />
) : isTool ? (
```

Don't forget to close the ternary properly.

**Step 5: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Test manually**

Run: `pnpm dev`
- Start a complex task that would trigger todowrite
- Verify sidebar appears when todos are created
- Verify inline cards appear in message stream
- Verify progress updates as todos complete

**Step 7: Commit**

```bash
git add apps/desktop/src/renderer/pages/Execution.tsx
git commit -m "feat(ui): integrate TodoSidebar and TodoInlineCard into Execution page"
```

---

## Task 11: Final Verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (or fix any issues)

**Step 3: Test the feature manually**

Run: `pnpm dev`

Test scenarios:
1. Simple task (no todos) - should work as before, no sidebar
2. Complex task with todos - sidebar should appear, show progress
3. Completion with incomplete todos - should auto-continue
4. All todos completed - task should complete normally

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete todo breakdown feature implementation"
```

---

## Summary of Commits

1. `feat(shared): add TodoItem type for task breakdown`
2. `feat(ipc): forward todo:update events to renderer`
3. `feat(preload): expose onTodoUpdate for todo tracking`
4. `feat(completion): enforce todo completion before task success`
5. `feat(adapter): detect todowrite and emit todo:update events`
6. `feat(store): add todos state and actions`
7. `feat(ui): add TodoSidebar component`
8. `feat(ui): add TodoInlineCard for inline todo rendering`
9. `feat(ui): integrate TodoSidebar and TodoInlineCard into Execution page`
10. `feat: complete todo breakdown feature implementation`
