# Task Completion Redesign: Replacing the Enforcer

**Date:** 2026-01-26
**Status:** Draft / Brainstorm
**Branch:** `perf/solve-completion-issue`

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current System Analysis](#current-system-analysis)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Industry Research](#industry-research)
5. [Option A: Manager Agent (Task Decomposition)](#option-a-manager-agent-task-decomposition)
6. [Option B: Improved Enforcer (Progress Ledger)](#option-b-improved-enforcer-progress-ledger)
7. [Comparison Matrix](#comparison-matrix)
8. [Recommendation](#recommendation)

---

## Problem Statement

The current task completion system uses a **Complete Task MCP tool** + **CompletionEnforcer** state machine. While it successfully prevents premature task abandonment, it causes three critical issues:

1. **Conversation pollution** — Continuation prompts are injected as "user messages" into the execution page, confusing real user intent with system enforcement
2. **Completion loops** — Up to 20 retry cycles where the agent repeatedly stops and gets nudged, wasting tokens and time
3. **Architectural complexity** — A 9-state machine + MCP server + prompt injection system that is difficult to maintain and debug

### Observed Failure Example

A task to "Check Google Calendar for tomorrow's meetings and draft preparation notes in a Google Doc" failed as follows:

| Time | Event | Todo State |
|------|-------|-----------|
| 20:31:08 | Initial `todowrite` call | Todo 1: in_progress, Todos 2-4: pending |
| 20:31:08-43 | Browser automation (navigate, click, screenshot) | No todo updates |
| 20:31:46 | **STOP** — `reason: "stop"`, only 2 output tokens | No todos completed |

The agent stopped with **only 2 output tokens** — indicating model truncation (ran out of output tokens or hit context limit), not a deliberate decision to stop.

---

## Current System Analysis

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Electron Main Process                                       │
│                                                             │
│  ┌───────────────┐    ┌──────────────────────┐              │
│  │ Task Manager   │───>│ OpenCode Adapter      │             │
│  └───────────────┘    │                      │              │
│                       │  ┌────────────────┐  │              │
│                       │  │ Stream Parser   │  │              │
│                       │  └───────┬────────┘  │              │
│                       │          │           │              │
│                       │  ┌───────▼────────┐  │              │
│                       │  │ Completion     │  │              │
│                       │  │ Enforcer       │  │              │
│                       │  │ (9-state FSM)  │  │              │
│                       │  └───────┬────────┘  │              │
│                       │          │           │              │
│                       └──────────┼───────────┘              │
│                                  │                          │
└──────────────────────────────────┼──────────────────────────┘
                                   │ PTY (node-pty)
                                   ▼
                    ┌──────────────────────────┐
                    │ opencode run "prompt"     │
                    │ --format json             │
                    │ --agent accomplish        │
                    │ --session <id>            │
                    └──────────┬───────────────┘
                               │ MCP
                    ┌──────────▼───────────────┐
                    │ complete-task MCP server  │
                    │ (agent MUST call this)    │
                    └──────────────────────────┘
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `apps/desktop/skills/complete-task/src/index.ts` | MCP server providing `complete_task` tool | ~100 |
| `src/main/opencode/completion/completion-enforcer.ts` | Main enforcer orchestration & callbacks | ~300 |
| `src/main/opencode/completion/completion-state.ts` | 9-state explicit state machine | ~210 |
| `src/main/opencode/completion/prompts.ts` | Continuation & verification prompt templates | ~110 |
| `src/main/opencode/adapter.ts` | Detects `complete_task` calls, integrates enforcer | ~1300 |
| `src/main/opencode/config-generator.ts` | System prompt with completion instructions | ~800 |

### Current Flow

```
Agent receives task → Works on it → Stops (step_finish reason='stop')
                                         │
                                    ┌────▼─────┐
                                    │ Did agent │
                                    │ call      │──── YES ──→ Verification flow
                                    │ complete_ │              (screenshot + re-check)
                                    │ task?     │
                                    └────┬──────┘
                                         │ NO
                                    ┌────▼─────┐
                                    │ Spawn new │
                                    │ opencode  │──→ Injects "REMINDER" prompt
                                    │ run with  │    as user message
                                    │ --session │──→ Up to 20 retries
                                    └───────────┘
```

### Problems with Current System

1. **`complete_task` is unreliable**: When the model truncates (2 output tokens), it physically cannot call any tool. The tool requirement fights against how LLMs terminate.

2. **Continuation prompts appear as user messages**: `spawnSessionResumption()` creates a new `opencode run` with `--session <id>` and the continuation prompt as the "user message." This pollutes the conversation history visible to the user.

3. **Generic prompts cause loops**: The continuation prompt is a static "REMINDER: You must call complete_task when finished." This doesn't tell the agent WHAT to do next, so it may repeat the same actions or stop again.

4. **20 retries is excessive**: Each retry spawns a new PTY process, consumes tokens, and adds latency.

5. **Verification requires screenshot**: The success verification flow requires the agent to take a screenshot, which doesn't work well across session resumptions and isn't relevant for non-browser tasks.

---

## Root Cause Analysis

### Why Does the Agent Stop Prematurely?

The agent emits `stop` / `end_turn` with very few output tokens. This is **not a deliberate decision** — it's model truncation caused by:

1. **Output token limits**: Provider-specific limits (e.g., Azure Foundry sets `max_output_tokens: 16384`). When the agent's response approaches this limit, the model truncates mid-output.

2. **Context window pressure**: As the conversation grows (system prompt + tool calls + results + screenshots), the model has less room for output. Browser screenshots are particularly large.

3. **Model behavior variance**: Different models (Claude, GPT-4, Gemini) handle truncation differently. Some cut off cleanly; others emit `stop` with minimal output.

### Why This Doesn't Happen in Standard OpenCode TUI

In the TUI:
- The user can type follow-up messages manually
- There's no requirement to call a specific tool
- If the agent stops, the user just says "continue"
- The conversation is naturally interactive

In Openwork's `opencode run` mode:
- The process exits when the agent stops
- No one can type "continue"
- The enforcer has to simulate this by spawning new processes

### The Fundamental Issue

**The `complete_task` MCP tool creates a circular dependency**: The agent must call a tool to signal completion, but if it hits token limits, it can't call any tool. The enforcer exists to compensate for this unreliability, but it introduces its own problems.

---

## Industry Research

### How Major Projects Handle Task Completion

| Project | Stars | Completion Signal | Separate Judge? | Handles Premature Stops |
|---------|-------|------------------|----------------|------------------------|
| **Claude Code** | 30k+ | `end_turn` (model stops) | No | Process exits; user re-prompts |
| **Cline** | 35k+ | `attempt_completion` tool | No (human only) | Forces tool use per response |
| **OpenHands** | 40k+ | `FinishTool` call | Tried self-assessment: 60% accuracy | Iteration/cost limits |
| **SWE-agent** | 13k+ | `submit` bash command | Self-review in v1.0+ | Auto-submission on timeout |
| **Devin** | Closed | Compound system | Yes (autonomous evaluator agents) | Intent deviation detection |
| **AutoGen** | 40k+ | `FunctionCallTermination` | Yes (critic agent pattern) | Timeout/max-message safety |
| **CrewAI** | 25k+ | Manager review + guardrails | Yes (multi-layered) | Manager re-delegation |
| **Bolt.new** | 14k+ | Stream termination | No | Token limit continuation |
| **MetaGPT** | 45k+ | Pipeline progression | N/A (SOP-driven) | Executable feedback loop |

### Key Industry Findings

1. **Most coding agents use self-reported completion** — Cline, SWE-agent, OpenHands, Bolt.new all trust the agent to say "I'm done." No external verification.

2. **Agent self-assessment is unreliable** — OpenHands measured their `task_completed` self-report at ~60% accuracy and removed it because it degraded benchmark performance.

3. **Devin is the only product with true autonomous evaluator agents** — Separate agents with full tool access (browser, shell, editor) verify complex outcomes. Not open-source.

4. **AutoGen MagenticOne is the best open-source reference** — Uses a dual-loop orchestrator with Task Ledger (planning) + Progress Ledger (step-by-step evaluation). Structured JSON assessment at each step.

5. **No framework shares browser state between sub-agents** — But Openwork's browser is app-managed with persistent profiles, so this isn't a constraint (see below).

### Browser Architecture (Openwork-Specific)

Critical finding: **The browser is NOT per-task.** It's a persistent app-level service:

- Single dev-browser server on port 9224, started once per app session
- Persistent profile directory (cookies/sessions survive across tasks)
- Each `opencode run` connects to the **same browser** via MCP
- Pages are isolated by task ID prefix, but cookies are shared

**This means the Manager Agent pattern (separate `opencode run` per sub-task) gets browser continuity for free.** A Google login from sub-task 1 persists for sub-task 2.

---

## Option A: Manager Agent (Task Decomposition)

### Overview

Replace the enforcer with a **Manager Agent** that decomposes tasks into bounded sub-tasks before execution. Each sub-task runs as a separate `opencode run` call. The manager evaluates results and dispatches remaining work.

Inspired by: **AutoGen MagenticOne** (dual-loop orchestrator), **Claude Code** (Task tool with subagents), **LangGraph** (supervisor pattern).

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Electron Main Process                                       │
│                                                             │
│  ┌───────────────┐                                          │
│  │ Task Manager   │                                         │
│  └───────┬───────┘                                          │
│          │                                                  │
│  ┌───────▼───────────────────────────────────┐              │
│  │ Manager Agent (LLM call)                  │              │
│  │                                           │              │
│  │  ┌─────────────┐   ┌──────────────────┐   │              │
│  │  │ Task Ledger  │   │ Progress Ledger  │   │              │
│  │  │ (decomposed  │   │ (tracks results  │   │              │
│  │  │  sub-tasks)  │   │  per sub-task)   │   │              │
│  │  └─────────────┘   └──────────────────┘   │              │
│  │                                           │              │
│  │  Outer Loop: Plan → Dispatch → Evaluate   │              │
│  └───────┬───────────────────────────────────┘              │
│          │                                                  │
│  ┌───────▼───────────────────────────────────┐              │
│  │ Sub-task Executor                         │              │
│  │                                           │              │
│  │  opencode run "sub-task 1" --format json  │              │
│  │  opencode run "sub-task 2" --format json  │              │
│  │  opencode run "sub-task N" --format json  │              │
│  └───────────────────────────────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

#### Phase 1: Decomposition (Manager LLM Call)

The Manager makes a direct API call (using the user's API key and selected model) to decompose the task:

**Input:**
```json
{
  "role": "system",
  "content": "You are a task decomposition agent. Break the user's request into 2-5 sequential sub-tasks. Each sub-task must be self-contained and completable in a single agent session. Output JSON."
},
{
  "role": "user",
  "content": "Check Google Calendar for tomorrow's meetings and draft preparation notes in a Google Doc"
}
```

**Output (Task Ledger):**
```json
{
  "sub_tasks": [
    {
      "id": 1,
      "description": "Open Google Calendar in the browser and list all meetings scheduled for tomorrow (January 27, 2026). Record the meeting title, time, and attendees for each.",
      "success_criteria": "A list of tomorrow's meetings with titles, times, and attendees",
      "depends_on": []
    },
    {
      "id": 2,
      "description": "Create a new Google Doc titled 'Meeting Preparation Notes - January 27, 2026'. For each meeting found, create a section with the meeting title, time, attendees, and draft 2-3 preparation bullet points.",
      "success_criteria": "A Google Doc exists with preparation notes for each meeting",
      "depends_on": [1]
    }
  ]
}
```

#### Phase 2: Execution (OpenCode Per Sub-Task)

Each sub-task is dispatched as a separate `opencode run`:

```bash
opencode run "Sub-task: Open Google Calendar in the browser and list all meetings scheduled for tomorrow..." --format json --agent accomplish
```

**No `--session` flag** — each sub-task is a fresh session. This is intentional:
- Fresh context window (no accumulated tool results eating space)
- Bounded scope reduces chance of truncation
- If it fails, we know exactly which sub-task failed

**No `complete_task` MCP tool** — the sub-task simply runs until `end_turn` / `stop`.

#### Phase 3: Evaluation (Manager LLM Call)

After each sub-task's OpenCode process exits, the Manager evaluates:

**Input:**
```json
{
  "role": "system",
  "content": "Evaluate whether this sub-task was completed. You will see the sub-task description, success criteria, and the agent's conversation output. Return JSON with {completed: boolean, summary: string, output_data: string}."
},
{
  "role": "user",
  "content": "Sub-task: 'List all meetings for tomorrow'\nSuccess criteria: 'A list of meetings with titles, times, attendees'\nAgent output: [last N messages from the opencode run output]"
}
```

**Output (Progress Ledger update):**
```json
{
  "completed": true,
  "summary": "Found 3 meetings: 9am Team Standup (5 attendees), 11am Design Review (3 attendees), 2pm Client Call (2 attendees)",
  "output_data": "Meeting 1: Team Standup, 9:00 AM, Alice/Bob/Carol/Dave/Eve\nMeeting 2: Design Review, 11:00 AM, Alice/Frank/Grace\nMeeting 3: Client Call, 2:00 PM, Alice/Henry"
}
```

#### Phase 4: Dispatch Next or Retry

- If completed → pass `output_data` as context to the next sub-task
- If not completed → retry the same sub-task (max 2 retries)
- If max retries exhausted → mark as failed, report to user
- If all sub-tasks done → task complete

#### Phase 5: Context Passing Between Sub-Tasks

Sub-task 2's prompt includes results from sub-task 1:

```
Sub-task: Create a new Google Doc titled 'Meeting Preparation Notes - January 27, 2026'.
For each meeting, create a section with preparation notes.

Context from previous steps:
- Meeting 1: Team Standup, 9:00 AM, Alice/Bob/Carol/Dave/Eve
- Meeting 2: Design Review, 11:00 AM, Alice/Frank/Grace
- Meeting 3: Client Call, 2:00 PM, Alice/Henry
```

### Implementation Plan

#### New Files to Create

```
src/main/opencode/manager/
├── manager-agent.ts          # Main orchestration logic
├── task-ledger.ts            # Sub-task decomposition & tracking
├── progress-ledger.ts        # Per sub-task evaluation & results
├── llm-client.ts             # Direct API calls (Anthropic, OpenAI, Google, xAI)
└── prompts.ts                # Decomposition, evaluation, retry prompts
```

#### Files to Modify

```
src/main/opencode/adapter.ts          # Remove enforcer integration, simplify step_finish handling
src/main/opencode/task-manager.ts     # Integrate manager agent before spawning opencode run
src/main/opencode/config-generator.ts # Remove complete_task instructions from system prompt
src/main/ipc/handlers.ts              # Add manager progress events to IPC
```

#### Files to Delete

```
src/main/opencode/completion/completion-enforcer.ts
src/main/opencode/completion/completion-state.ts
src/main/opencode/completion/prompts.ts
apps/desktop/skills/complete-task/     # Entire MCP server directory
```

#### Key Implementation Details

**1. LLM Client for Manager/Evaluator Calls**

The manager needs to make direct API calls using the user's stored API key. This requires a lightweight client that supports all providers:

```typescript
// src/main/opencode/manager/llm-client.ts
interface LLMClient {
  chat(messages: Message[], options?: { json?: boolean }): Promise<string>;
}

// Factory based on user's selected provider
function createLLMClient(provider: string, apiKey: string, model: string): LLMClient;
```

Providers to support:
- Anthropic (Claude) — `@anthropic-ai/sdk`
- OpenAI — `openai` SDK
- Google (Gemini) — `@google/generative-ai`
- xAI (Grok) — OpenAI-compatible API

**2. Sub-Task Execution**

Each sub-task uses the existing `OpenCodeAdapter` but with simplified configuration:
- No `complete_task` MCP server
- No enforcer
- System prompt focuses on the sub-task only
- `step_finish` with `stop`/`end_turn` = sub-task done (process exits)

**3. Progress UI**

The manager can emit progress events to the renderer:

```typescript
// IPC events
'manager:decomposed'     // { subTasks: SubTask[] }
'manager:subtask-start'  // { subTaskId: number, description: string }
'manager:subtask-done'   // { subTaskId: number, completed: boolean, summary: string }
'manager:task-complete'  // { allCompleted: boolean, summary: string }
```

The execution page can show: "Step 2/3: Creating Google Doc with preparation notes..."

### Pros

- **Eliminates the enforcer entirely** — no state machine, no continuation prompts, no conversation pollution
- **Bounded sub-tasks reduce truncation risk** — each sub-task has a fresh context window, less likely to hit token limits
- **Clear progress tracking** — user sees "Step 2/3" instead of cryptic enforcer retries
- **Natural retry semantics** — retrying a sub-task is clean (fresh session), not a continuation prompt injected into a long conversation
- **Browser state preserved** — persistent browser profile means logins carry across sub-tasks
- **Simpler agent instructions** — each sub-task prompt is focused and short, easier for the model to follow
- **Aligns with industry patterns** — MagenticOne, Claude Code Task tool, LangGraph supervisor all use this pattern

### Cons

- **Requires an LLM client in the main process** — must implement API calls for each provider (Anthropic, OpenAI, Google, xAI). This is new infrastructure.
- **Manager calls cost tokens** — decomposition call + evaluation call per sub-task uses the same (potentially expensive) model
- **Context loss between sub-tasks** — results from sub-task 1 must be explicitly passed to sub-task 2 as text. Rich context (screenshots, DOM state, exact browser position) is lost.
- **Pre-decomposition may be inaccurate** — the manager doesn't know what the agent will find. It may create sub-tasks that turn out to be unnecessary or miss steps that become apparent during execution.
- **Simple tasks get over-decomposed** — "Open google.com" doesn't need decomposition. Need a heuristic to skip the manager for simple tasks.
- **No `--session` continuity** — each sub-task is a fresh OpenCode session. The agent can't reference what happened in previous sub-tasks except through the text context passed in the prompt.
- **Significant architectural change** — new manager layer, new LLM client, new IPC events, modified adapter, new UI components

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Manager decomposes incorrectly | Medium | High | Allow user to override/edit decomposition; add "simple task" bypass |
| Sub-task still truncates | Low | Medium | Sub-tasks are bounded; if truncated, retry once then report |
| LLM client bugs across providers | Medium | Medium | Start with one provider (Anthropic), add others incrementally |
| Context loss causes sub-task failure | Medium | Medium | Include rich context summaries; allow sub-tasks to access previous session logs |
| Over-decomposition waste tokens | Low | Low | Heuristic: skip manager for tasks under N words |

---

## Option B: Improved Enforcer (Progress Ledger)

### Overview

Keep the single `opencode run` per task model but replace the current enforcer with a **Progress Ledger evaluator** — an external LLM call (not injected into the agent's conversation) that evaluates whether the task is complete and generates targeted continuation prompts.

Inspired by: **AutoGen MagenticOne's Progress Ledger** (structured JSON evaluation at each step), **Devin's evaluator agents** (external verification with full tool access).

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Electron Main Process                                       │
│                                                             │
│  ┌───────────────┐    ┌──────────────────────┐              │
│  │ Task Manager   │───>│ OpenCode Adapter      │             │
│  └───────────────┘    │                      │              │
│                       │  ┌────────────────┐  │              │
│                       │  │ Stream Parser   │  │              │
│                       │  └───────┬────────┘  │              │
│                       │          │           │              │
│                       └──────────┼───────────┘              │
│                                  │                          │
│              ┌───────────────────┼──────────────────┐       │
│              │     step_finish   │  (reason='stop') │       │
│              │                   ▼                   │       │
│              │  ┌─────────────────────────────────┐  │       │
│              │  │ Progress Ledger Evaluator       │  │       │
│              │  │ (External LLM call)             │  │       │
│              │  │                                 │  │       │
│              │  │ Input: original request +       │  │       │
│              │  │        agent conversation log + │  │       │
│              │  │        todo state               │  │       │
│              │  │                                 │  │       │
│              │  │ Output: {                       │  │       │
│              │  │   done: boolean,                │  │       │
│              │  │   summary: string,              │  │       │
│              │  │   remaining: string[],          │  │       │
│              │  │   continuation_prompt: string,  │  │       │
│              │  │   is_stuck: boolean             │  │       │
│              │  │ }                               │  │       │
│              │  └──────────┬──────────────────────┘  │       │
│              │             │                         │       │
│              │     ┌───────▼────────┐                │       │
│              │     │ done?          │                │       │
│              │     │                │                │       │
│              │     │ YES → complete │                │       │
│              │     │ NO → resume    │                │       │
│              │     │      session   │                │       │
│              │     │ STUCK → stop   │                │       │
│              │     └────────────────┘                │       │
│              └──────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

#### Step 1: Agent Runs Normally

Same as today: `opencode run "prompt" --format json --agent accomplish`. The agent works on the task. The stream parser captures all output.

**Key difference:** No `complete_task` MCP tool. The system prompt does NOT tell the agent to call any completion tool. The agent simply works until it stops.

#### Step 2: Agent Stops → External Evaluation

When `step_finish` fires with `reason='stop'` or `reason='end_turn'`, instead of the current enforcer logic, the adapter calls the **Progress Ledger Evaluator** — an external LLM call.

**Evaluator Input:**
```json
{
  "role": "system",
  "content": "You are a task completion evaluator. Given the original request and the agent's conversation log, determine if the task is complete. Be strict: if any part of the request was not addressed, mark as incomplete. Return JSON."
},
{
  "role": "user",
  "content": "ORIGINAL REQUEST:\nCheck Google Calendar for tomorrow's meetings and draft preparation notes in a Google Doc\n\nAGENT CONVERSATION LOG (last 20 messages):\n[... stream parser output ...]\n\nTODO STATE:\n- [in_progress] Check Google Calendar\n- [pending] Create Google Doc\n- [pending] Draft prep notes\n- [pending] Review and finalize\n\nEvaluate: Is this task complete?"
}
```

**Evaluator Output:**
```json
{
  "done": false,
  "summary": "The agent opened Google Calendar and viewed tomorrow's meetings but stopped before creating the Google Doc or drafting preparation notes.",
  "remaining": [
    "Create a new Google Doc",
    "Draft preparation notes for each meeting found"
  ],
  "continuation_prompt": "You were checking Google Calendar and found tomorrow's meetings. Now you need to: 1) Create a new Google Doc titled 'Meeting Preparation Notes', 2) For each meeting, draft 2-3 preparation bullet points. Continue working.",
  "is_stuck": false
}
```

#### Step 3: Resume or Complete

- **If `done: true`** → emit `task:complete` with the summary
- **If `done: false` and `is_stuck: false`** → resume session with the targeted `continuation_prompt`
- **If `done: false` and `is_stuck: true`** → emit `task:complete` with partial status and summary of what was accomplished
- **Max 5 evaluation cycles** (not 20) — if still not done after 5, report partial completion

#### Step 4: Clean Session Resumption

When resuming, use `--session <id>` with the evaluator's `continuation_prompt`. This is still a "user message" in the OpenCode session, but:

- It's **targeted** (not a generic "REMINDER")
- It tells the agent exactly what remains
- The evaluator detected stuckness, so it won't retry infinitely

#### Step 5: UI Handling

Continuation prompts are marked differently in the UI:

```typescript
// IPC event
'task:continuation' // { reason: 'evaluator', remaining: [...], attempt: 2 }
```

The execution page shows: "Evaluator: 2 items remaining — continuing..." instead of showing the continuation prompt as a user message.

### Implementation Plan

#### New Files to Create

```
src/main/opencode/evaluator/
├── progress-evaluator.ts     # Main evaluation logic
├── llm-client.ts             # Direct API calls (shared with Option A)
└── prompts.ts                # Evaluation prompt templates
```

#### Files to Modify

```
src/main/opencode/adapter.ts          # Replace enforcer with evaluator call on step_finish
src/main/opencode/config-generator.ts # Remove complete_task from system prompt + MCP config
src/main/ipc/handlers.ts              # Add evaluator events to IPC
src/renderer/pages/Execution.tsx       # Display continuation differently (not as user message)
```

#### Files to Delete

```
src/main/opencode/completion/completion-enforcer.ts
src/main/opencode/completion/completion-state.ts
src/main/opencode/completion/prompts.ts
apps/desktop/skills/complete-task/     # Entire MCP server directory
```

#### Key Implementation Details

**1. LLM Client (Same as Option A)**

Same infrastructure needed: direct API calls to the user's selected provider.

**2. Conversation Log Extraction**

The evaluator needs the agent's conversation log. The stream parser already captures all messages. We need to:
- Buffer the last N messages (or last M tokens worth)
- Format them for the evaluator prompt
- Include tool call names and results (summarized)

```typescript
// In adapter.ts
private conversationBuffer: ParsedMessage[] = [];

// On each message from stream parser:
this.conversationBuffer.push(message);

// On step_finish:
const log = this.formatConversationLog(this.conversationBuffer);
const evaluation = await this.evaluator.evaluate(originalRequest, log, todoState);
```

**3. Stuckness Detection**

The evaluator should detect when the agent is stuck in a loop:

```json
{
  "is_stuck": true,
  "stuck_reason": "The agent has attempted to access Google Calendar 3 times but keeps getting a CAPTCHA. This is an unresolvable blocker."
}
```

This prevents the infinite retry loop.

**4. Reduced Retries**

Max 5 evaluation cycles instead of 20. Each cycle includes:
- One LLM evaluation call (~500 tokens)
- One session resumption (if not done)
- The evaluation call adds ~2-5 seconds

### Pros

- **No conversation pollution** — evaluation happens outside the agent's conversation. The continuation prompt is the only injected message, and it's targeted.
- **Smarter continuations** — instead of generic "REMINDER," the evaluator tells the agent exactly what remains
- **Stuckness detection** — prevents infinite loops by detecting when the agent is repeating actions
- **Fewer retries** — 5 max instead of 20, with more intelligent decisions
- **Simpler system prompt** — no need for `complete_task` instructions, todo enforcement rules, or verification requirements
- **Smaller architectural change** — replaces the enforcer with an evaluator, keeps the single `opencode run` model
- **Session continuity** — `--session` preserves full conversation context, the agent remembers everything it did
- **No context loss** — unlike Option A, the agent has the full conversation history

### Cons

- **Still injects "user messages"** — continuation prompts via `--session` still appear as user messages in the OpenCode session. The UI can hide them, but the agent sees them.
- **Evaluator costs tokens** — each evaluation call uses the same (potentially expensive) model. 5 evaluations = 5 extra API calls.
- **Conversation still grows** — each continuation adds to the context window. If the agent is stopping due to context pressure, continuations make it worse.
- **Evaluator accuracy depends on model** — smaller/cheaper models may not evaluate well. Since we use the user's selected model, evaluation quality varies.
- **Session resumption still creates new PTY processes** — each continuation spawns a new `opencode run --session`. The process lifecycle is unchanged.
- **Partial solution to conversation pollution** — the continuation prompt is better (targeted vs generic), but it's still an injected message. The UI must explicitly handle this.
- **Requires LLM client in main process** — same infrastructure as Option A

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Evaluator incorrectly marks task as done | Medium | High | Be strict in evaluation prompt; include todo state as evidence |
| Continuation prompt doesn't help (agent stops again immediately) | Medium | Medium | Stuckness detection limits retries; max 5 cycles |
| Context window overflow on continuation | Low-Medium | High | Summarize conversation log for evaluator; don't pass full history |
| Evaluator latency degrades UX | Low | Medium | Evaluator call is ~2-5 seconds; show "Evaluating progress..." in UI |
| LLM client bugs | Medium | Medium | Same mitigation as Option A |

---

## Comparison Matrix

| Dimension | Option A: Manager Agent | Option B: Improved Enforcer |
|-----------|------------------------|----------------------------|
| **Architecture change** | Large (new manager layer, sub-task execution, context passing) | Medium (replace enforcer with evaluator, same execution model) |
| **Files to create** | ~5 new files + LLM client | ~3 new files + LLM client |
| **Files to delete** | Same (enforcer + complete-task MCP) | Same |
| **Conversation pollution** | None (each sub-task is a clean session) | Reduced (targeted continuation prompts, UI can hide them) |
| **Completion loops** | Eliminated (bounded sub-tasks, max 2 retries per sub-task) | Reduced (5 max evaluations with stuckness detection) |
| **Token efficiency** | Higher overhead (decomposition + evaluation per sub-task) | Lower overhead (evaluation only when agent stops) |
| **Context preservation** | Lost between sub-tasks (text summary only) | Full (--session preserves everything) |
| **Truncation risk** | Low (bounded sub-tasks have fresh context) | Same as today (long conversations still hit limits) |
| **Progress visibility** | Excellent ("Step 2/3: Creating Google Doc") | Good ("Evaluator: 2 items remaining") |
| **Simple task handling** | Needs bypass heuristic ("don't decompose simple tasks") | Works naturally (just run and evaluate) |
| **Browser state** | Preserved (persistent browser profile) | Preserved (same session) |
| **Stuckness detection** | Natural (sub-task retry limit) | Requires evaluator intelligence |
| **Model dependency** | Uses user's model for manager + sub-tasks | Uses user's model for evaluator |
| **Session continuity** | None (fresh sessions) | Full (--session) |
| **Industry alignment** | MagenticOne, Claude Code Task tool, LangGraph | MagenticOne Progress Ledger, Devin evaluator |
| **Implementation effort** | ~2-3 weeks (estimate removed per instructions) | ~1-2 weeks (estimate removed per instructions) |
| **Risk level** | Higher (new paradigm, more moving parts) | Lower (evolutionary improvement) |

---

## Recommendation

**Start with Option B (Improved Enforcer / Progress Ledger)** for these reasons:

1. **Lower risk** — It's an evolutionary improvement, not a paradigm shift. If it doesn't work, you can revert.

2. **Solves the immediate problems** — Targeted continuation prompts fix conversation pollution. Stuckness detection fixes loops. Removing `complete_task` MCP simplifies the system.

3. **Foundation for Option A** — The LLM client infrastructure built for Option B's evaluator is the same infrastructure needed for Option A's manager. If you later want to add task decomposition, you have the building blocks.

4. **No context loss** — Option B preserves full session context. Option A's context passing (text summaries between sub-tasks) is a significant quality regression that would need careful engineering.

5. **Simple tasks work naturally** — No need for a "skip decomposition" heuristic. The evaluator only fires if the agent stops.

**If Option B proves insufficient** (e.g., agents still truncate repeatedly on long tasks despite targeted continuations), then **graduate to Option A** — add the manager layer on top of the evaluator infrastructure.

### Recommended Implementation Order

1. Build the LLM client (direct API calls to Anthropic, OpenAI, Google, xAI)
2. Build the Progress Ledger Evaluator
3. Remove the `complete_task` MCP server
4. Remove the CompletionEnforcer
5. Integrate the evaluator into the adapter's `step_finish` handler
6. Update system prompt (remove completion tool instructions)
7. Update UI to handle evaluator events differently from user messages
8. Test with real tasks across providers

---

## Appendix: References

### Open-Source Projects Analyzed

- [Claude Code](https://github.com/anthropics/claude-code) (30k+ stars) — Agent loop with `end_turn`
- [Cline](https://github.com/cline/cline) (35k+ stars) — `attempt_completion` tool
- [OpenHands](https://github.com/All-Hands-AI/OpenHands) (40k+ stars) — `FinishTool`, 60% self-assessment accuracy
- [AutoGen](https://github.com/microsoft/autogen) (40k+ stars) — MagenticOne, FunctionCallTermination
- [CrewAI](https://github.com/crewAIInc/crewAI) (25k+ stars) — Hierarchical manager, guardrails
- [SWE-agent](https://github.com/SWE-agent/SWE-agent) (13k+ stars) — `submit` command
- [LangGraph](https://github.com/langchain-ai/langgraph) (10k+ stars) — Supervisor pattern
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT) (45k+ stars) — SOP pipeline
- [Bolt.new](https://github.com/stackblitz/bolt.new) (14k+ stars) — Stream termination
- [Mastra](https://github.com/mastra-ai/mastra) (30k+ stars) — Agent network routing
- [OpenCode](https://github.com/sst/opencode) (25k+ stars) — SDK/Server API, session events

### Key Documentation

- [Claude Code Agent Loop Internals](https://kotrotsos.medium.com/claude-code-internals-part-2-the-agent-loop-5b3977640894)
- [Anthropic: Building Agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [AutoGen Termination Conditions](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/tutorial/termination.html)
- [MagenticOne Documentation](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/magentic-one.html)
- [Cognition: Evaluating Coding Agents](https://cognition.ai/blog/evaluating-coding-agents)
- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/)
- [Evaluator-Optimizer Pattern](https://www.agentrecipes.com/evaluator-optimizer)
- [LLM Agent Evaluation Guide](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)
