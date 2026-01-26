# Progress Ledger Evaluator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `CompletionEnforcer` (9-state FSM + `complete_task` MCP server + prompt injection) with a Progress Ledger Evaluator — an external LLM call via OpenCode CLI that evaluates task completion and generates targeted continuation prompts.

**Architecture:** When the agent stops (`step_finish` with `reason='stop'/'end_turn'`), instead of the old FSM deciding whether to continue/verify, we spawn a lightweight evaluator OpenCode CLI instance (`--agent evaluator`) that reads the conversation log + todo state and returns `{ done, summary, remaining[], continuation_prompt, is_stuck }`. If not done, we resume the original session with the evaluator's continuation prompt. Max 5 cycles.

**Tech Stack:** TypeScript, Electron IPC, OpenCode CLI (`node-pty`), React/Zustand (renderer), `@accomplish/shared` types.

---

## Task 1: Create ConversationBuffer

**Files:**
- Create: `apps/desktop/src/main/opencode/evaluator/conversation-buffer.ts`

**Step 1: Create the file**

```typescript
// apps/desktop/src/main/opencode/evaluator/conversation-buffer.ts
import type { OpenCodeMessage, OpenCodeToolUseMessage } from '@accomplish/shared';

interface BufferedMessage {
  role: 'assistant' | 'tool';
  content: string;
  timestamp: string;
}

/**
 * Collects and formats agent messages for evaluator input.
 * Keeps a sliding window of the most recent messages.
 */
export class ConversationBuffer {
  private messages: BufferedMessage[] = [];
  private maxMessages: number;

  constructor(maxMessages = 30) {
    this.maxMessages = maxMessages;
  }

  /**
   * Add a message from the StreamParser.
   * Filters to only text and tool_use messages (the evaluator doesn't need step_start/step_finish).
   */
  addMessage(msg: OpenCodeMessage): void {
    if (msg.type === 'text' && msg.part.text) {
      this.messages.push({
        role: 'assistant',
        content: msg.part.text,
        timestamp: msg.timestamp || new Date().toISOString(),
      });
    } else if (msg.type === 'tool_use') {
      const toolMsg = msg as OpenCodeToolUseMessage;
      const toolName = toolMsg.part.tool || 'unknown';
      const status = toolMsg.part.state?.status || 'unknown';
      const output = toolMsg.part.state?.output || '';
      // Truncate long tool outputs
      const truncatedOutput = output.length > 500
        ? output.substring(0, 500) + '...[truncated]'
        : output;
      this.messages.push({
        role: 'tool',
        content: `[Tool: ${toolName}] Status: ${status}${truncatedOutput ? `\nOutput: ${truncatedOutput}` : ''}`,
        timestamp: msg.timestamp || new Date().toISOString(),
      });
    } else if (msg.type === 'tool_call') {
      const toolName = msg.part.tool || 'unknown';
      this.messages.push({
        role: 'tool',
        content: `[Tool call: ${toolName}]`,
        timestamp: msg.timestamp || new Date().toISOString(),
      });
    }

    // Enforce sliding window
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  /**
   * Format messages into readable text for the evaluator prompt.
   */
  formatForEvaluation(): string {
    if (this.messages.length === 0) {
      return '[No messages recorded]';
    }

    return this.messages
      .map((m) => {
        const prefix = m.role === 'assistant' ? 'ASSISTANT' : 'TOOL';
        return `[${prefix}] ${m.content}`;
      })
      .join('\n\n');
  }

  /**
   * Get the number of buffered messages.
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Reset buffer for new task.
   */
  reset(): void {
    this.messages = [];
  }
}
```

**Step 2: Verify the file compiles**

Run: `pnpm typecheck`
Expected: No new errors

**Step 3: Commit**

```bash
git add apps/desktop/src/main/opencode/evaluator/conversation-buffer.ts
git commit -m "feat: add ConversationBuffer for evaluator context collection"
```

---

## Task 2: Create Evaluator Prompts

**Files:**
- Create: `apps/desktop/src/main/opencode/evaluator/prompts.ts`

**Step 1: Create the file**

```typescript
// apps/desktop/src/main/opencode/evaluator/prompts.ts
import type { TodoItem } from '@accomplish/shared';

export interface EvaluationResult {
  done: boolean;
  summary: string;
  remaining: string[];
  continuation_prompt: string;
  is_stuck: boolean;
}

/**
 * System prompt for the evaluator agent.
 * Registered in OpenCode config as agent "evaluator".
 * Instructs the LLM to return ONLY valid JSON.
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are a task completion evaluator. Your ONLY job is to determine if an AI agent has completed its assigned task.

You will receive:
1. The original user request
2. The agent's conversation log (what the agent said and did)
3. The agent's todo list (if any)
4. Previous evaluation results (if this is a retry)

You MUST return ONLY a valid JSON object with this exact schema:
{
  "done": boolean,
  "summary": string,
  "remaining": string[],
  "continuation_prompt": string,
  "is_stuck": boolean
}

RULES:
- Return ONLY the JSON object. No explanation, no markdown, no extra text.
- "done" should be true ONLY if every part of the original request has been addressed.
- "remaining" should list specific, actionable items — not vague descriptions.
- "continuation_prompt" should be a clear, direct instruction that tells the agent exactly what to do next. Include context about what's already been done so the agent doesn't repeat work. If done=true, set this to empty string.
- "is_stuck" should be true if: (a) previous evaluations show the same remaining items, or (b) the agent has made no meaningful progress, or (c) the agent hit an unresolvable blocker.
- If there are incomplete todos, the task is NOT done regardless of what the agent said.`;

/**
 * Build the evaluation prompt with all context.
 */
export function buildEvaluationPrompt(
  originalRequest: string,
  conversationLog: string,
  todoState: TodoItem[] | null,
  previousEvaluations: EvaluationResult[]
): string {
  const parts: string[] = [];

  parts.push(`## ORIGINAL REQUEST\n${originalRequest}`);
  parts.push(`## AGENT CONVERSATION LOG\n${conversationLog}`);
  parts.push(`## TODO STATE\n${formatTodoState(todoState)}`);

  if (previousEvaluations.length > 0) {
    const evalSummary = previousEvaluations
      .map((e, i) => {
        const remainingStr = e.remaining.length > 0
          ? `Remaining: ${e.remaining.join(', ')}`
          : 'No remaining items';
        return `Evaluation ${i + 1}: done=${e.done}, stuck=${e.is_stuck}, ${remainingStr}`;
      })
      .join('\n');
    parts.push(`## PREVIOUS EVALUATIONS\n${evalSummary}`);
  }

  parts.push(`## INSTRUCTIONS\nEvaluate whether the agent has completed the original request. Return ONLY valid JSON.`);

  return parts.join('\n\n');
}

/**
 * Format todo items for inclusion in the evaluation prompt.
 */
export function formatTodoState(todos: TodoItem[] | null): string {
  if (!todos || todos.length === 0) {
    return 'No todos created by agent.';
  }

  const statusIcon: Record<string, string> = {
    completed: '[x]',
    in_progress: '[~]',
    pending: '[ ]',
    cancelled: '[-]',
  };

  return todos
    .map((t) => `${statusIcon[t.status] || '[ ]'} ${t.content}`)
    .join('\n');
}
```

**Step 2: Verify the file compiles**

Run: `pnpm typecheck`
Expected: No new errors

**Step 3: Commit**

```bash
git add apps/desktop/src/main/opencode/evaluator/prompts.ts
git commit -m "feat: add evaluator prompt templates and EvaluationResult type"
```

---

## Task 3: Create ProgressEvaluator and Index

**Files:**
- Create: `apps/desktop/src/main/opencode/evaluator/progress-evaluator.ts`
- Create: `apps/desktop/src/main/opencode/evaluator/index.ts`

**Step 1: Create progress-evaluator.ts**

This is a large file — the main evaluator class. It spawns an OpenCode CLI process as an evaluator agent, collects output, parses JSON, and detects stuckness.

Key implementation details:
- Uses `node-pty` to spawn the evaluator process (same as `adapter.ts`)
- Reuses the same shell command building helpers as the adapter
- Builds environment with API keys (same as adapter)
- Parses JSON from evaluator output using multiple strategies (raw JSON, markdown-wrapped, stream parser output)
- Detects stuckness by comparing remaining items across consecutive evaluations (>80% overlap = stuck)
- 60-second timeout per evaluation
- Tracks evaluation history for stuckness detection

```typescript
// apps/desktop/src/main/opencode/evaluator/progress-evaluator.ts
import * as pty from 'node-pty';
import { app } from 'electron';
import fs from 'fs';
import { getOpenCodeCliPath } from '../cli-path';
import { getBundledNodePaths } from '../../utils/bundled-node';
import { getExtendedNodePath } from '../../utils/system-path';
import { getAllApiKeys, getBedrockCredentials } from '../../store/secureStorage';
import { getActiveProviderModel } from '../../store/providerSettings';
import { getSelectedModel } from '../../store/appSettings';
import type { TodoItem } from '@accomplish/shared';
import {
  buildEvaluationPrompt,
  type EvaluationResult,
} from './prompts';
import type { EvaluationContext } from './index';

const DEFAULT_MAX_CYCLES = 5;
const EVALUATOR_TIMEOUT_MS = 60000;

export class ProgressEvaluator {
  private maxCycles: number;
  private evaluationHistory: EvaluationResult[] = [];
  private currentProcess: pty.IPty | null = null;
  private isDisposed = false;

  constructor(maxCycles = DEFAULT_MAX_CYCLES) {
    this.maxCycles = maxCycles;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    if (this.isDisposed) {
      throw new Error('Evaluator has been disposed');
    }

    const prompt = buildEvaluationPrompt(
      context.originalRequest,
      context.conversationLog,
      context.todoState,
      this.evaluationHistory
    );

    const rawOutput = await this.spawnEvaluatorProcess(prompt);
    const result = this.parseEvaluatorResponse(rawOutput);

    if (!result.is_stuck) {
      result.is_stuck = this.detectStuckness(result);
    }

    this.evaluationHistory.push(result);
    return result;
  }

  get cycleCount(): number {
    return this.evaluationHistory.length;
  }

  get isMaxCyclesReached(): boolean {
    return this.evaluationHistory.length >= this.maxCycles;
  }

  get lastResult(): EvaluationResult | null {
    return this.evaluationHistory.length > 0
      ? this.evaluationHistory[this.evaluationHistory.length - 1]
      : null;
  }

  get history(): readonly EvaluationResult[] {
    return this.evaluationHistory;
  }

  private async spawnEvaluatorProcess(prompt: string): Promise<string> {
    const { command, args: baseArgs } = getOpenCodeCliPath();

    const cliArgs = ['run', prompt, '--format', 'json', '--agent', 'evaluator'];

    // Add model selection (reuse same logic as adapter.buildCliArgs)
    const activeModel = getActiveProviderModel();
    const selectedModel = activeModel || getSelectedModel();
    if (selectedModel?.model) {
      if (selectedModel.provider === 'zai') {
        const modelId = selectedModel.model.split('/').pop();
        cliArgs.push('--model', `zai-coding-plan/${modelId}`);
      } else if (selectedModel.provider === 'deepseek') {
        const modelId = selectedModel.model.split('/').pop();
        cliArgs.push('--model', `deepseek/${modelId}`);
      } else if (selectedModel.provider === 'openrouter') {
        cliArgs.push('--model', selectedModel.model);
      } else if (selectedModel.provider === 'ollama') {
        const modelId = selectedModel.model.replace(/^ollama\//, '');
        cliArgs.push('--model', `ollama/${modelId}`);
      } else if (selectedModel.provider === 'litellm') {
        const modelId = selectedModel.model.replace(/^litellm\//, '');
        cliArgs.push('--model', `litellm/${modelId}`);
      } else {
        cliArgs.push('--model', selectedModel.model);
      }
    }

    const allArgs = [...baseArgs, ...cliArgs];
    const env = await this.buildEvaluatorEnvironment();
    const safeCwd = app.getPath('temp');

    return new Promise<string>((resolve, reject) => {
      let output = '';
      let timeoutId: ReturnType<typeof setTimeout>;

      const fullCommand = this.buildShellCommand(command, allArgs);
      const shellCmd = this.getPlatformShell();
      const shellArgs = this.getShellArgs(fullCommand);

      console.log('[ProgressEvaluator] Spawning evaluator');

      const proc = pty.spawn(shellCmd, shellArgs, {
        name: 'xterm-256color',
        cols: 200,
        rows: 30,
        cwd: safeCwd,
        env: env as { [key: string]: string },
      });

      this.currentProcess = proc;

      proc.onData((data: string) => {
        const clean = data
          .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
          .replace(/\x1B\][^\x07]*\x07/g, '')
          .replace(/\x1B\][^\x1B]*\x1B\\/g, '');
        output += clean;
      });

      proc.onExit(({ exitCode }) => {
        clearTimeout(timeoutId);
        this.currentProcess = null;
        if (this.isDisposed) {
          reject(new Error('Evaluator was disposed'));
          return;
        }
        if (exitCode !== 0 && exitCode !== null) {
          console.warn(`[ProgressEvaluator] Process exited with code ${exitCode}`);
        }
        resolve(output);
      });

      timeoutId = setTimeout(() => {
        console.warn('[ProgressEvaluator] Evaluation timed out');
        try { proc.kill(); } catch { /* ignore */ }
        this.currentProcess = null;
        reject(new Error('Evaluator timed out'));
      }, EVALUATOR_TIMEOUT_MS);
    });
  }

  private parseEvaluatorResponse(output: string): EvaluationResult {
    const defaultResult: EvaluationResult = {
      done: false,
      summary: 'Evaluation failed to produce valid output',
      remaining: ['Unable to determine remaining work'],
      continuation_prompt: 'Please continue working on the original task and finish all remaining items.',
      is_stuck: true,
    };

    if (!output.trim()) {
      console.warn('[ProgressEvaluator] Empty evaluator output');
      return defaultResult;
    }

    // Strategy 1: ```json ... ``` blocks
    const jsonBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      try { return this.validateResult(JSON.parse(jsonBlockMatch[1].trim())); }
      catch { /* try next */ }
    }

    // Strategy 2: Outermost { ... }
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return this.validateResult(JSON.parse(jsonMatch[0])); }
      catch { /* try next */ }
    }

    // Strategy 3: Parse stream JSON lines for text messages containing JSON
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'text' && parsed.part?.text) {
            const innerMatch = parsed.part.text.match(/\{[\s\S]*\}/);
            if (innerMatch) {
              try { return this.validateResult(JSON.parse(innerMatch[0])); }
              catch { /* continue */ }
            }
          }
          // Try parsing the line itself as an EvaluationResult
          if ('done' in parsed) {
            return this.validateResult(parsed);
          }
        } catch { /* continue */ }
      }
    }

    console.warn('[ProgressEvaluator] Failed to parse evaluator output');
    return defaultResult;
  }

  private validateResult(raw: Record<string, unknown>): EvaluationResult {
    return {
      done: typeof raw.done === 'boolean' ? raw.done : false,
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      remaining: Array.isArray(raw.remaining) ? raw.remaining.map(String) : [],
      continuation_prompt: typeof raw.continuation_prompt === 'string' ? raw.continuation_prompt : '',
      is_stuck: typeof raw.is_stuck === 'boolean' ? raw.is_stuck : false,
    };
  }

  private detectStuckness(result: EvaluationResult): boolean {
    if (this.evaluationHistory.length === 0) return false;
    const previous = this.evaluationHistory[this.evaluationHistory.length - 1];
    if (previous.remaining.length === 0 || result.remaining.length === 0) return false;

    const prevSet = new Set(previous.remaining.map(s => s.toLowerCase().trim()));
    const currSet = new Set(result.remaining.map(s => s.toLowerCase().trim()));
    let overlap = 0;
    for (const item of currSet) {
      if (prevSet.has(item)) overlap++;
    }
    return overlap / Math.max(prevSet.size, currSet.size) > 0.8;
  }

  private async buildEvaluatorEnvironment(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (app.isPackaged) {
      env.ELECTRON_RUN_AS_NODE = '1';
      const bundledNode = getBundledNodePaths();
      if (bundledNode) {
        const delimiter = process.platform === 'win32' ? ';' : ':';
        env.PATH = `${bundledNode.binDir}${delimiter}${env.PATH || ''}`;
        env.NODE_BIN_PATH = bundledNode.binDir;
      }
      if (process.platform === 'darwin') {
        env.PATH = getExtendedNodePath(env.PATH);
      }
    }

    const apiKeys = await getAllApiKeys();
    if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
    if (apiKeys.openai) env.OPENAI_API_KEY = apiKeys.openai;
    if (apiKeys.google) env.GOOGLE_GENERATIVE_AI_API_KEY = apiKeys.google;
    if (apiKeys.xai) env.XAI_API_KEY = apiKeys.xai;
    if (apiKeys.deepseek) env.DEEPSEEK_API_KEY = apiKeys.deepseek;
    if (apiKeys.zai) env.ZAI_API_KEY = apiKeys.zai;
    if (apiKeys.openrouter) env.OPENROUTER_API_KEY = apiKeys.openrouter;
    if (apiKeys.litellm) env.LITELLM_API_KEY = apiKeys.litellm;
    if (apiKeys.minimax) env.MINIMAX_API_KEY = apiKeys.minimax;

    const bedrockCredentials = getBedrockCredentials();
    if (bedrockCredentials) {
      if (bedrockCredentials.authType === 'accessKeys') {
        env.AWS_ACCESS_KEY_ID = bedrockCredentials.accessKeyId;
        env.AWS_SECRET_ACCESS_KEY = bedrockCredentials.secretAccessKey;
        if (bedrockCredentials.sessionToken) env.AWS_SESSION_TOKEN = bedrockCredentials.sessionToken;
      } else if (bedrockCredentials.authType === 'profile') {
        env.AWS_PROFILE = bedrockCredentials.profileName;
      }
      if (bedrockCredentials.region) env.AWS_REGION = bedrockCredentials.region;
    }

    if (process.env.OPENCODE_CONFIG) env.OPENCODE_CONFIG = process.env.OPENCODE_CONFIG;
    return env;
  }

  private escapeShellArg(arg: string): string {
    if (process.platform === 'win32') {
      if (arg.includes(' ') || arg.includes('"')) return `"${arg.replace(/"/g, '""')}"`;
      return arg;
    }
    const needsEscaping = ["'", ' ', '$', '`', '\\', '"', '\n'].some(c => arg.includes(c));
    if (needsEscaping) return `'${arg.replace(/'/g, "'\\''")}'`;
    return arg;
  }

  private buildShellCommand(command: string, args: string[]): string {
    const escaped = this.escapeShellArg(command);
    const escapedArgs = args.map(a => this.escapeShellArg(a));
    if (process.platform === 'win32' && escaped.startsWith('"')) return ['&', escaped, ...escapedArgs].join(' ');
    return [escaped, ...escapedArgs].join(' ');
  }

  private getPlatformShell(): string {
    if (process.platform === 'win32') return 'powershell.exe';
    if (app.isPackaged && process.platform === 'darwin') return '/bin/sh';
    const userShell = process.env.SHELL;
    if (userShell) return userShell;
    if (fs.existsSync('/bin/bash')) return '/bin/bash';
    if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
    return '/bin/sh';
  }

  private getShellArgs(command: string): string[] {
    if (process.platform === 'win32') {
      return ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
    }
    return ['-c', command];
  }

  reset(): void {
    this.evaluationHistory = [];
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.currentProcess) {
      try { this.currentProcess.kill(); } catch { /* ignore */ }
      this.currentProcess = null;
    }
  }
}
```

**Step 2: Create the index.ts barrel export**

```typescript
// apps/desktop/src/main/opencode/evaluator/index.ts
export { ProgressEvaluator } from './progress-evaluator';
export { ConversationBuffer } from './conversation-buffer';
export {
  EVALUATOR_SYSTEM_PROMPT,
  buildEvaluationPrompt,
  formatTodoState,
} from './prompts';
export type { EvaluationResult } from './prompts';

import type { TodoItem } from '@accomplish/shared';
import type { EvaluationResult } from './prompts';

export interface EvaluationContext {
  originalRequest: string;
  conversationLog: string;
  todoState: TodoItem[] | null;
  previousEvaluations: EvaluationResult[];
}
```

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: No new errors

**Step 4: Commit**

```bash
git add apps/desktop/src/main/opencode/evaluator/
git commit -m "feat: add ProgressEvaluator with CLI spawning, JSON parsing, stuckness detection"
```

---

## Task 4: Add Evaluator Agent to OpenCode Config + Simplify Agent Prompt

**Files:**
- Modify: `apps/desktop/src/main/opencode/config-generator.ts`

**Step 1: Add import for evaluator system prompt**

At the top imports, add:
```typescript
import { EVALUATOR_SYSTEM_PROMPT } from './evaluator';
```

**Step 2: Add evaluator agent to the config object**

In the `agent` property of the `config` object (around line 746), add the evaluator agent:

```typescript
agent: {
  [ACCOMPLISH_AGENT_NAME]: {
    description: 'Browser automation assistant using dev-browser',
    prompt: systemPrompt,
    mode: 'primary',
  },
  evaluator: {
    description: 'Task completion evaluator - returns JSON assessment',
    prompt: EVALUATOR_SYSTEM_PROMPT,
  },
},
```

**Step 3: Remove complete-task MCP server entry**

Delete the `'complete-task'` entry from the `mcp` object (lines ~779-785):
```typescript
// DELETE:
'complete-task': {
  type: 'local',
  command: ['npx', 'tsx', path.join(skillsPath, 'complete-task', 'src', 'index.ts')],
  enabled: true,
  timeout: 30000,
},
```

**Step 4: Simplify the accomplish agent system prompt**

In `ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE`:

1. Replace the `<behavior name="task-planning">` block (lines ~147-190) with:
```
<behavior name="task-planning">
When starting a task:
1. **State the goal** - What the user wants accomplished
2. **List steps** - Numbered steps to achieve the goal
3. **Call todowrite** - Create a task list so the user can see progress in the sidebar

Update todo status as you work. Mark items as completed when done.
</behavior>
```

2. Replace the big `<behavior>` block (lines ~192-254) with:
```
<behavior name="task-execution">
- Use AskUserQuestion tool for clarifying questions before starting ambiguous tasks
- **NEVER use shell commands (open, xdg-open, start, subprocess, webbrowser) to open browsers or URLs** - ALL browser operations MUST use browser_* MCP tools.
- For multi-step browser workflows, prefer \`browser_script\` over individual tools.

**BROWSER ACTION VERBOSITY:**
- Before each browser action, briefly explain what you're about to do
- After navigation: mention the page title and what you see
- After clicking: describe what you clicked and what happened
- After typing: confirm what you typed and where

**DO NOT ASK FOR PERMISSION TO CONTINUE:**
If the user gave you a task with specific criteria, keep working until you meet them.

**TASK COMPLETION:**
Work until the task is complete, then simply stop. The system will evaluate your progress.
- If you finish all parts of the request, stop and the evaluator will confirm completion
- If you hit a technical blocker (login wall, CAPTCHA, rate limit), describe what happened and stop
- Do NOT worry about calling any special completion tool — just do the work and stop
</behavior>
```

3. Remove the `<tool name="request_file_permission">` reference to `complete_task` tool if present (the tool doc block at lines ~109-139 is for file-permission and should stay).

4. Remove the line about `complete_task` from the comment at line ~739 (`// Note: todowrite is disabled by default and must be explicitly enabled.`) — the comment references `complete_task` behavior that no longer exists. Just clean up the comment.

**Step 5: Verify compilation**

Run: `pnpm typecheck`
Expected: No new errors

**Step 6: Commit**

```bash
git add apps/desktop/src/main/opencode/config-generator.ts
git commit -m "feat: add evaluator agent to config, remove complete-task MCP, simplify agent prompt"
```

---

## Task 5: Integrate Evaluator into Adapter (core integration)

**Files:**
- Modify: `apps/desktop/src/main/opencode/adapter.ts`

This is the core task. Replace `CompletionEnforcer` with `ProgressEvaluator` and `ConversationBuffer`.

**Step 1: Replace imports**

Remove:
```typescript
import { CompletionEnforcer, CompletionEnforcerCallbacks } from './completion';
```

Add:
```typescript
import { ProgressEvaluator, ConversationBuffer } from './evaluator';
import type { EvaluationResult } from './evaluator';
```

**Step 2: Replace class properties**

Remove `private completionEnforcer: CompletionEnforcer;`

Add:
```typescript
private evaluator: ProgressEvaluator;
private conversationBuffer: ConversationBuffer;
private originalRequest: string = '';
private lastTodoState: TodoItem[] | null = null;
private isEvaluating: boolean = false;
```

**Step 3: Update constructor**

Remove `this.completionEnforcer = this.createCompletionEnforcer();`

Add:
```typescript
this.evaluator = new ProgressEvaluator();
this.conversationBuffer = new ConversationBuffer();
```

**Step 4: Delete `createCompletionEnforcer()` method**

Remove the entire method (lines ~108-128).

**Step 5: Wire ConversationBuffer into setupStreamParsing**

Change the message handler in `setupStreamParsing()` to also feed the buffer:

```typescript
this.streamParser.on('message', (message: OpenCodeMessage) => {
  this.handleMessage(message);
  this.conversationBuffer.addMessage(message);
});
```

**Step 6: Update startTask() reset logic**

After `this.hasReceivedFirstTool = false;`, add:
```typescript
this.originalRequest = config.prompt;
this.lastTodoState = null;
this.isEvaluating = false;
this.evaluator.reset();
this.conversationBuffer.reset();
```

Remove: `this.completionEnforcer.reset();`

**Step 7: Remove complete_task detection from handleMessage**

In both `tool_call` and `tool_use` cases, delete the blocks:
```typescript
if (toolName === 'complete_task' || toolName.endsWith('_complete_task')) {
  this.completionEnforcer.handleCompleteTaskDetection(toolInput);
}
```

Keep the todowrite blocks but replace `this.completionEnforcer.updateTodos(input.todos)` with `this.lastTodoState = input.todos;`

**Step 8: Replace step_finish case**

Replace the entire `case 'step_finish':` block with:
```typescript
case 'step_finish':
  if (message.part.reason === 'error') {
    if (!this.hasCompleted) {
      this.hasCompleted = true;
      this.emit('complete', {
        status: 'error',
        sessionId: this.currentSessionId || undefined,
        error: 'Task failed',
      });
    }
    break;
  }
  // stop/end_turn: evaluator runs on process exit
  // tool_use: agent is continuing, do nothing
  break;
```

**Step 9: Replace handleProcessExit**

Replace with:
```typescript
private handleProcessExit(code: number | null): void {
  this.ptyProcess = null;

  if (this.wasInterrupted && code === 0 && !this.hasCompleted) {
    this.hasCompleted = true;
    this.emit('complete', {
      status: 'interrupted',
      sessionId: this.currentSessionId || undefined,
    });
    this.currentTaskId = null;
    return;
  }

  if (code === 0 && !this.hasCompleted && !this.isEvaluating) {
    this.runEvaluation().catch((error) => {
      console.error('[OpenCode Adapter] Evaluation error:', error);
      this.hasCompleted = true;
      this.emit('complete', {
        status: 'error',
        sessionId: this.currentSessionId || undefined,
        error: `Evaluation failed: ${error.message}`,
      });
    });
    return;
  }

  if (!this.hasCompleted) {
    if (code !== null && code !== 0) {
      this.emit('error', new Error(`OpenCode CLI exited with code ${code}`));
    }
  }
  this.currentTaskId = null;
}
```

**Step 10: Add runEvaluation() method**

Add new method to `OpenCodeAdapter`:
```typescript
private async runEvaluation(): Promise<void> {
  if (this.isDisposed || this.hasCompleted) return;
  this.isEvaluating = true;

  this.emit('progress', { stage: 'evaluating', message: 'Evaluating progress...' });

  try {
    const context = {
      originalRequest: this.originalRequest,
      conversationLog: this.conversationBuffer.formatForEvaluation(),
      todoState: this.lastTodoState,
      previousEvaluations: [...this.evaluator.history],
    };

    console.log(`[OpenCode Adapter] Running evaluation cycle ${this.evaluator.cycleCount + 1}`);
    const result = await this.evaluator.evaluate(context);
    console.log(`[OpenCode Adapter] Evaluation: done=${result.done}, stuck=${result.is_stuck}, remaining=${result.remaining.length}`);
    this.emit('debug', { type: 'evaluation', message: `done=${result.done}, stuck=${result.is_stuck}`, data: result });

    if (result.done) {
      this.hasCompleted = true;
      this.isEvaluating = false;
      this.emit('complete', { status: 'success', sessionId: this.currentSessionId || undefined, summary: result.summary });
      return;
    }

    if (result.is_stuck || this.evaluator.isMaxCyclesReached) {
      this.hasCompleted = true;
      this.isEvaluating = false;
      const summary = result.summary + (result.remaining.length > 0 ? `\n\nRemaining: ${result.remaining.join(', ')}` : '');
      this.emit('complete', { status: 'success', sessionId: this.currentSessionId || undefined, summary });
      return;
    }

    this.isEvaluating = false;
    await this.spawnSessionResumption(result.continuation_prompt);
  } catch (error) {
    this.isEvaluating = false;
    console.error('[OpenCode Adapter] Evaluation error:', error);
    this.hasCompleted = true;
    this.emit('complete', { status: 'success', sessionId: this.currentSessionId || undefined, summary: 'Task completed (evaluation unavailable)' });
  }
}
```

**Step 11: Update dispose()**

Add cleanup lines:
```typescript
this.evaluator.dispose();
this.conversationBuffer.reset();
this.originalRequest = '';
this.lastTodoState = null;
this.isEvaluating = false;
```

**Step 12: Verify compilation**

Run: `pnpm typecheck`
Expected: No new errors

**Step 13: Commit**

```bash
git add apps/desktop/src/main/opencode/adapter.ts
git commit -m "feat: replace CompletionEnforcer with ProgressEvaluator in adapter"
```

---

## Task 6: Add Evaluating Stage to Renderer

**Files:**
- Modify: `apps/desktop/src/renderer/stores/taskStore.ts`

**Step 1: Add 'evaluating' to STARTUP_STAGES**

Change line 555:
```typescript
const STARTUP_STAGES = ['starting', 'browser', 'environment', 'loading', 'connecting', 'waiting', 'evaluating'];
```

This causes the existing `onTaskProgress` handler to show the "Evaluating progress..." message in the startup progress indicator when `stage === 'evaluating'` arrives.

**Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/stores/taskStore.ts
git commit -m "feat: show evaluator progress in task startup stages"
```

---

## Task 7: Delete Old Completion Files

**Files:**
- Delete: `apps/desktop/src/main/opencode/completion/` (entire directory)
- Delete: `apps/desktop/skills/complete-task/` (entire directory)

**Step 1: Delete the files**

```bash
cd /Users/danielscharfstein/Documents/accomplish/github-repos/openwork.perf-solve-completion-issue
rm -rf apps/desktop/src/main/opencode/completion/
rm -rf apps/desktop/skills/complete-task/
```

**Step 2: Check for any remaining imports**

Search for imports of the deleted modules:
```bash
grep -rn "from.*completion" apps/desktop/src/ --include="*.ts" --include="*.tsx"
grep -rn "complete-task" apps/desktop/src/ --include="*.ts" --include="*.tsx"
```

If any remain, remove them. The adapter import was already replaced in Task 5.

**Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove CompletionEnforcer, completion state machine, and complete-task MCP server"
```

---

## Task 8: Build and Smoke Test

**Step 1: Build the project**

```bash
pnpm build
```
Expected: Clean build, no errors

**Step 2: Run in dev mode**

```bash
pnpm dev
```

**Step 3: Verify basic task flow**

Submit a simple task. Verify:
- Agent works normally
- On agent stop, "Evaluating progress..." appears
- Task completes with summary
- No console errors

**Step 4: Commit (only if fixes needed)**

If any fixes were needed during testing, commit them:
```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```

---

## Summary of All Changes

| File | Action | Description |
|------|--------|-------------|
| `evaluator/conversation-buffer.ts` | Create | Message collector with sliding window + formatting |
| `evaluator/prompts.ts` | Create | Evaluator system prompt, evaluation prompt builder, types |
| `evaluator/progress-evaluator.ts` | Create | CLI spawner, JSON parser, stuckness detection |
| `evaluator/index.ts` | Create | Barrel exports + EvaluationContext type |
| `config-generator.ts` | Modify | Add evaluator agent, remove complete-task MCP, simplify agent prompt |
| `adapter.ts` | Modify | Replace CompletionEnforcer with ProgressEvaluator + ConversationBuffer |
| `stores/taskStore.ts` | Modify | Add 'evaluating' to STARTUP_STAGES |
| `completion/` | Delete | Remove all old FSM files (4 files) |
| `skills/complete-task/` | Delete | Remove complete-task MCP server |
