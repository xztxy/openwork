# Claude-Like Chat Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve chat UX with collapsible activity rows and consistent agent personality across all LLM providers.

**Architecture:** Two independent changes: (1) Add personality/behavior sections to system prompt in config-generator.ts, (2) Create ActivityRow component to replace inline tool messages and thinking indicator.

**Tech Stack:** React, TypeScript, Framer Motion, Tailwind CSS

---

## Task 1: Add Personality Section to System Prompt

**Files:**
- Modify: `apps/desktop/src/main/opencode/config-generator.ts:35-52`

**Step 1: Add personality section after `</capabilities>`**

In `config-generator.ts`, find line 52 (`</capabilities>`) and add immediately after:

```typescript
</capabilities>

<personality>
You are a thoughtful, capable assistant. Your communication style:

- Be warm but professional - friendly without being overly casual or eager
- Explain your reasoning when it helps the user understand
- Acknowledge uncertainty honestly - say "I'm not sure" rather than guessing
- Be concise - get to the point without filler phrases
- Prioritize what matters - when showing results, highlight the most relevant first

Avoid:
- Excessive enthusiasm ("Certainly!", "Absolutely!", "I'd be happy to!")
- Self-referential phrases ("As an AI...", "As your assistant...")
- Unnecessary apologies or hedging
- Narrating obvious actions ("I am now going to...")

When working on tasks:
- Briefly acknowledge what you're doing, then do it
- Share meaningful progress, not every internal step
- Summarize results clearly at the end
- Ask clarifying questions upfront rather than assuming
</personality>

<important name="filesystem-rules">
```

**Step 2: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 3: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/main/opencode/config-generator.ts
git commit -m "feat: add personality section to system prompt"
```

---

## Task 2: Add Asking-Questions Rule to System Prompt

**Files:**
- Modify: `apps/desktop/src/main/opencode/config-generator.ts` (after personality section)

**Step 1: Add asking-questions critical section after `</personality>`**

```typescript
</personality>

<critical name="asking-questions">
##############################################################################
# ASKING QUESTIONS - STOP AND WAIT
##############################################################################

When you ask the user a question, you MUST stop and wait for their response.
Do not continue processing, do not "work ahead", do not call more tools.

WRONG (asking but continuing):
  "What are your product's pricing tiers?"
  [continues with TodoWrite, more tool calls, more text...]

RIGHT (asking then stopping):
  "What are your product's pricing tiers?"
  [STOP - wait for user response before any further action]

A question is a handoff. You are giving control to the user.
Your message should END with the question. Nothing after it.

If you don't actually need to wait for an answer, don't phrase it as a question.
Instead, state your assumption and proceed:
  "I'll compare against standard startup pricing tiers."
##############################################################################
</critical>

<important name="filesystem-rules">
```

**Step 2: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 3: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/main/opencode/config-generator.ts
git commit -m "feat: add asking-questions rule to system prompt"
```

---

## Task 3: Create ActivityRow Component

**Files:**
- Create: `apps/desktop/src/renderer/components/execution/ActivityRow.tsx`

**Step 1: Create the execution components directory**

```bash
mkdir -p /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience/apps/desktop/src/renderer/components/execution
```

**Step 2: Create ActivityRow.tsx**

```tsx
import { useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, CheckCircle2, FileText, Search, Terminal, Brain, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { springs } from '../../lib/animations';
import loadingSymbol from '/assets/loading-symbol.svg';

// Tool icon mapping
const TOOL_ICONS: Record<string, typeof FileText> = {
  Read: FileText,
  Write: FileText,
  Edit: FileText,
  Glob: Search,
  Grep: Search,
  Bash: Terminal,
  Task: Brain,
  WebFetch: Globe,
  WebSearch: Globe,
};

export interface ActivityRowProps {
  id: string;
  tool: string;
  input: unknown;
  output?: string;
  status: 'running' | 'complete';
}

/**
 * Generate smart summary based on tool and input
 */
function getSummary(tool: string, input: unknown): string {
  const inp = input as Record<string, unknown>;

  switch (tool) {
    case 'Read': {
      const filePath = inp?.file_path as string;
      if (filePath) {
        const basename = filePath.split('/').pop() || filePath;
        return `Reading \`${basename}\``;
      }
      return 'Reading file';
    }

    case 'Write': {
      const filePath = inp?.file_path as string;
      if (filePath) {
        const basename = filePath.split('/').pop() || filePath;
        return `Writing \`${basename}\``;
      }
      return 'Writing file';
    }

    case 'Edit': {
      const filePath = inp?.file_path as string;
      if (filePath) {
        const basename = filePath.split('/').pop() || filePath;
        return `Editing \`${basename}\``;
      }
      return 'Editing file';
    }

    case 'Glob': {
      const pattern = inp?.pattern as string;
      return pattern ? `Finding files matching \`${pattern}\`` : 'Finding files';
    }

    case 'Grep': {
      const pattern = inp?.pattern as string;
      return pattern ? `Searching for \`${pattern}\`` : 'Searching code';
    }

    case 'WebFetch': {
      const url = inp?.url as string;
      if (url) {
        try {
          const hostname = new URL(url).hostname;
          return `Navigating to \`${hostname}\``;
        } catch {
          return `Fetching ${url}`;
        }
      }
      return 'Fetching web page';
    }

    case 'WebSearch': {
      const query = inp?.query as string;
      return query ? `Searching web for \`${query}\`` : 'Searching web';
    }

    case 'Bash': {
      const description = inp?.description as string;
      if (description) return description;
      const command = inp?.command as string;
      if (command) {
        const shortCmd = command.length > 40 ? command.slice(0, 40) + '...' : command;
        return `Running \`${shortCmd}\``;
      }
      return 'Running command';
    }

    case 'Task': {
      const description = inp?.description as string;
      return description || 'Running agent';
    }

    default:
      return tool;
  }
}

/**
 * Format tool input for expanded view
 */
function formatInput(tool: string, input: unknown): string {
  const inp = input as Record<string, unknown>;

  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return inp?.file_path as string || '';

    case 'Glob':
      return inp?.pattern as string || '';

    case 'Grep':
      return `Pattern: ${inp?.pattern || ''}\nPath: ${inp?.path || '.'}`;

    case 'WebFetch':
      return inp?.url as string || '';

    case 'Bash':
      return inp?.command as string || '';

    default:
      return JSON.stringify(input, null, 2);
  }
}

// Spinning icon component
const SpinningIcon = ({ className }: { className?: string }) => (
  <img
    src={loadingSymbol}
    alt=""
    className={cn('animate-spin-ccw', className)}
  />
);

export const ActivityRow = memo(function ActivityRow({
  id,
  tool,
  input,
  output,
  status,
}: ActivityRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const Icon = TOOL_ICONS[tool] || Terminal;
  const summary = getSummary(tool, input);
  const details = formatInput(tool, input);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className="w-full"
    >
      {/* Collapsed row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg',
          'bg-muted/50 hover:bg-muted transition-colors',
          'text-left text-sm text-muted-foreground'
        )}
      >
        {/* Expand/collapse chevron */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}

        {/* Tool icon */}
        <Icon className="h-4 w-4 shrink-0" />

        {/* Summary text */}
        <span className="flex-1 truncate font-medium">{summary}</span>

        {/* Status indicator */}
        {status === 'running' ? (
          <SpinningIcon className="h-4 w-4 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        )}
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-6 p-3 rounded-lg bg-muted/30 border border-border">
              {/* Input details */}
              {details && (
                <div className="mb-2">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Input:</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground">
                    {details}
                  </pre>
                </div>
              )}

              {/* Output (if complete and has output) */}
              {status === 'complete' && output && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Output:</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground max-h-48 overflow-y-auto">
                    {output.length > 1000 ? output.slice(0, 1000) + '...' : output}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
```

**Step 3: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 4: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/renderer/components/execution/ActivityRow.tsx
git commit -m "feat: add ActivityRow component for collapsible tool activity"
```

---

## Task 4: Create ThinkingRow Component

**Files:**
- Create: `apps/desktop/src/renderer/components/execution/ThinkingRow.tsx`

**Step 1: Create ThinkingRow.tsx**

A simpler row for when the agent is thinking (no tool active).

```tsx
import { memo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { springs } from '../../lib/animations';
import loadingSymbol from '/assets/loading-symbol.svg';

// Spinning icon component
const SpinningIcon = ({ className }: { className?: string }) => (
  <img
    src={loadingSymbol}
    alt=""
    className={cn('animate-spin-ccw', className)}
  />
);

export const ThinkingRow = memo(function ThinkingRow() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={springs.gentle}
      className="w-full"
      data-testid="execution-thinking-indicator"
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg',
          'bg-muted/50 text-sm text-muted-foreground'
        )}
      >
        <SpinningIcon className="h-4 w-4 shrink-0" />
        <span className="font-medium">Thinking...</span>
      </div>
    </motion.div>
  );
});
```

**Step 2: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 3: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/renderer/components/execution/ThinkingRow.tsx
git commit -m "feat: add ThinkingRow component"
```

---

## Task 5: Create Index Export for Execution Components

**Files:**
- Create: `apps/desktop/src/renderer/components/execution/index.ts`

**Step 1: Create index.ts**

```typescript
export { ActivityRow } from './ActivityRow';
export type { ActivityRowProps } from './ActivityRow';
export { ThinkingRow } from './ThinkingRow';
```

**Step 2: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 3: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/renderer/components/execution/index.ts
git commit -m "feat: add index export for execution components"
```

---

## Task 6: Integrate ActivityRow into Execution.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/pages/Execution.tsx`

**Step 1: Add imports at top of file**

After line 16 (`import { isWaitingForUser } from '../lib/waiting-detection';`), add:

```typescript
import { ActivityRow, ThinkingRow } from '../components/execution';
```

**Step 2: Update message rendering logic**

Replace the message mapping section (approximately lines 446-480) that currently filters out bash tools and renders MessageBubble for everything.

Find this code block:
```tsx
{currentTask.messages
  .filter((m) => !(m.type === 'tool' && m.toolName?.toLowerCase() === 'bash'))
  .map((message, index, filteredMessages) => {
```

Replace the entire map function with:

```tsx
{currentTask.messages.map((message, index, allMessages) => {
  // Render tool messages as ActivityRow
  if (message.type === 'tool') {
    const isLastTool = !allMessages.slice(index + 1).some(m => m.type === 'tool');
    return (
      <ActivityRow
        key={message.id}
        id={message.id}
        tool={message.toolName || 'unknown'}
        input={message.toolInput}
        output={message.content}
        status={isLastTool && currentTask.status === 'running' ? 'running' : 'complete'}
      />
    );
  }

  // Render other messages as MessageBubble
  const filteredMessages = allMessages.filter(m => m.type !== 'tool');
  const filteredIndex = filteredMessages.findIndex(m => m.id === message.id);
  const isLastMessage = filteredIndex === filteredMessages.length - 1;
  const isLastAssistantMessage = message.type === 'assistant' && isLastMessage;

  // Find the last assistant message index for the continue button
  let lastAssistantIndex = -1;
  for (let i = filteredMessages.length - 1; i >= 0; i--) {
    if (filteredMessages[i].type === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }
  const isLastAssistantForContinue = filteredIndex === lastAssistantIndex;

  // Show continue button on last assistant message when:
  // - Task was interrupted (user can always continue)
  // - Task completed AND the message indicates agent is waiting for user action
  const showContinue = isLastAssistantForContinue && !!hasSession &&
    (currentTask.status === 'interrupted' ||
     (currentTask.status === 'completed' && isWaitingForUser(message.content)));

  return (
    <MessageBubble
      key={message.id}
      message={message}
      shouldStream={isLastAssistantMessage && currentTask.status === 'running'}
      isLastMessage={isLastMessage}
      isRunning={currentTask.status === 'running'}
      showContinueButton={showContinue}
      continueLabel={currentTask.status === 'interrupted' ? 'Continue' : 'Done, Continue'}
      onContinue={handleContinue}
      isLoading={isLoading}
    />
  );
})}
```

**Step 3: Replace the thinking indicator**

Find the AnimatePresence block with the thinking indicator (approximately lines 482-505):

```tsx
<AnimatePresence>
  {currentTask.status === 'running' && !permissionRequest && (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      ...
    </motion.div>
  )}
</AnimatePresence>
```

Replace it with:

```tsx
<AnimatePresence>
  {currentTask.status === 'running' && !permissionRequest && !currentTool && (
    <ThinkingRow />
  )}
</AnimatePresence>
```

**Step 4: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 5: Test manually**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm dev`

- Start a task
- Verify tool activities appear as collapsible rows
- Verify clicking expands to show details
- Verify "Thinking..." appears when no tool is active

**Step 6: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/renderer/pages/Execution.tsx
git commit -m "feat: integrate ActivityRow and ThinkingRow into Execution page"
```

---

## Task 7: Clean Up Unused Code

**Files:**
- Modify: `apps/desktop/src/renderer/pages/Execution.tsx`

**Step 1: Remove unused TOOL_PROGRESS_MAP from Execution.tsx**

The `TOOL_PROGRESS_MAP` constant (lines 30-43) is no longer needed in Execution.tsx since ActivityRow has its own icon mapping. Remove it.

**Step 2: Remove unused imports**

Remove these imports that are no longer used:
- `Wrench` from lucide-react (was used for tool messages)
- Any other unused imports

**Step 3: Verify the change compiles**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 4: Commit**

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add apps/desktop/src/renderer/pages/Execution.tsx
git commit -m "refactor: remove unused tool progress map and imports"
```

---

## Task 8: Final Verification and Lint

**Step 1: Run typecheck**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm typecheck`

Expected: No errors

**Step 2: Run lint**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm lint`

Expected: No errors

**Step 3: Manual testing**

Run: `cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience && pnpm dev`

Test with different providers if possible:
- Anthropic (Claude)
- OpenAI
- Google
- xAI

Verify:
1. Activity rows show for all tool calls
2. Clicking expands to show details
3. "Thinking..." shows when processing without tools
4. Agent personality is consistent (warm but professional, stops after questions)

**Step 4: Create summary commit if needed**

If any final fixes were made:

```bash
cd /Users/matan/Developer/Accomplish/openwork.claude-like-chat-experience
git add -A
git commit -m "fix: final adjustments for claude-like chat experience"
```
