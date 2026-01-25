# Completion MCP System Removal

This document describes the completion enforcement system that was removed in the `perf/remove-completion-mcp` branch.

## What Was the Completion System?

The completion system was a sophisticated enforcement mechanism that ensured the AI agent properly finished tasks before stopping. It required the agent to call a `complete_task` tool to signal task completion, and included verification and continuation flows.

---

## Files Deleted

### 1. `apps/desktop/skills/complete-task/` (entire directory)

**What it was:** An MCP server that provided the `complete_task` tool.

**Files:**
- `src/index.ts` - MCP server with the `complete_task` tool
- `package.json` - Dependencies
- `SKILL.md` - Documentation for the agent

**The tool accepted:**
```typescript
{
  status: 'success' | 'blocked' | 'partial',
  summary: string,
  original_request_summary: string,
  remaining_work?: string  // Required for 'partial' status
}
```

**What it did:** When the agent thought it was done, it had to call this tool. The status indicated:
- `success` - Task fully completed (triggered verification)
- `blocked` - Hit a technical blocker (login wall, CAPTCHA, etc.)
- `partial` - Partially done, needs to continue

---

### 2. `apps/desktop/src/main/opencode/completion/` (entire directory)

#### `completion-state.ts` - State Machine

**What it was:** An explicit state machine tracking the completion flow through 9 states:

```
IDLE → AWAITING_VERIFICATION → VERIFYING → VERIFICATION_CONTINUING
  ↓
COMPLETE_TASK_CALLED
  ↓
PARTIAL_CONTINUATION_PENDING → (back to IDLE to continue work)
  ↓
CONTINUATION_PENDING → MAX_RETRIES_REACHED
  ↓
DONE
```

**Why it existed:** Replaced 7+ boolean flags (`completeTaskCalled`, `isVerifying`, `verificationStarted`, etc.) with a single state variable for cleaner logic.

---

#### `completion-enforcer.ts` - Main Enforcement Logic

**What it was:** The coordinator that implemented two enforcement mechanisms:

**1. Continuation Prompts:**
- If the agent stopped WITHOUT calling `complete_task`, the system would spawn a new session with a reminder prompt
- Up to 20 retry attempts before giving up
- Prevented agents from just stopping mid-task

**2. Verification Flow:**
- If agent called `complete_task` with `status: "success"`, the system didn't trust it
- Spawned a verification session asking the agent to:
  - Take a screenshot of current browser state
  - Compare against the original request
  - Re-call `complete_task` only if verified
- Prevented false "success" claims

**Key methods:**
- `handleCompleteTaskDetection(input)` - Called when agent used the tool
- `handleStepFinish(reason)` - Decided whether to complete or schedule continuation
- `handleProcessExit(code)` - Triggered verification/continuation when CLI exited
- `updateTodos(todos)` - Tracked todo items for completion checking

---

#### `prompts.ts` - Prompt Templates

**What it was:** Templates for the continuation and verification prompts:

1. `getContinuationPrompt()` - Gentle reminder to finish work:
   > "You stopped without calling complete_task. Please continue working or call complete_task with the appropriate status."

2. `getVerificationPrompt(summary, originalRequest)` - Verification instructions:
   > "You claimed success. Take a screenshot and verify each requirement is met. Re-call complete_task only if verified."

3. `getPartialContinuationPrompt(remainingWork)` - For partial completion:
   > "You indicated partial completion. Continue with: [remaining_work]"

4. `getIncompleteTodosPrompt(incompleteTodos)` - Todo enforcement:
   > "These todos are still incomplete: [list]. Complete them before calling complete_task."

---

#### `index.ts` - Exports

Just re-exported the above modules.

---

## Files Modified

### 1. `apps/desktop/src/main/opencode/adapter.ts`

**Removed:**

| Item | What it did |
|------|-------------|
| `import { CompletionEnforcer }` | Import for the enforcer |
| `completionEnforcer` property | Instance of the enforcer |
| `createCompletionEnforcer()` method | Set up callbacks for verification/continuation |
| `completionEnforcer.reset()` | Reset state on new task |
| `complete_task` detection in `tool_call` | Tracked when agent called the tool |
| `complete_task` detection in `tool_use` | Same for combined tool events |
| `completionEnforcer.updateTodos()` | Tracked todo completion |
| `completionEnforcer.handleStepFinish()` | Delegated step_finish logic |
| `completionEnforcer.handleProcessExit()` | Delegated exit handling |
| `spawnSessionResumption()` method | Started new CLI session for verification/continuation |
| `lastWorkingDirectory` property | Stored CWD for session resumption |

**Changed:**
- `step_finish` handler: Now emits `complete` directly on stop/end_turn (was delegated to enforcer)
- `handleProcessExit`: Now emits `complete` directly on exit code 0 (was delegated to enforcer)

---

### 2. `apps/desktop/src/main/opencode/config-generator.ts`

**Removed from system prompt:**

1. **Task planning requirement** (partial):
   ```
   **STEP 4: COMPLETE ALL TODOS BEFORE FINISHING**
   - All todos must be "completed" or "cancelled" before calling complete_task
   ```

2. **Entire "TASK COMPLETION - CRITICAL" section** (~30 lines):
   - Required calling `complete_task` to finish ANY task
   - Explained when to use `success`, `blocked`, `partial`
   - Warned "NEVER just stop working without calling complete_task"
   - Forced re-reading original request via `original_request_summary`

**Removed from MCP config:**
```typescript
'complete-task': {
  type: 'local',
  command: ['npx', 'tsx', path.join(skillsPath, 'complete-task', 'src', 'index.ts')],
  enabled: true,
  timeout: 5000,
}
```

---

### 3. `apps/desktop/__tests__/unit/main/opencode/adapter.unit.test.ts`

**Removed tests:**
1. `should schedule continuation on step_finish when complete_task was not called` - Tested continuation scheduling
2. `should emit complete after max continuation attempts without complete_task` - Tested retry exhaustion

**Modified tests:**
1. `should emit complete event on step_finish with stop reason` - No longer needs `complete_task` call first
2. `should not emit duplicate complete events` - No longer simulates `complete_task` call

---

## Behavior Change Summary

| Before | After |
|--------|-------|
| Agent MUST call `complete_task` to finish | Agent stops when it decides to stop |
| System verifies "success" claims with screenshot | No verification |
| System prompts agent to continue if it stops without `complete_task` | No continuation prompts |
| Up to 20 retry attempts to get agent to call `complete_task` | Immediate completion |
| Todos must be completed before finishing | Todos shown in UI but not enforced |

---

## Why Was It Removed?

The completion enforcement system added complexity and overhead:
- Extra MCP server to maintain
- State machine complexity
- Session resumption logic
- Verification prompts consumed additional tokens
- Continuation retries could loop indefinitely in edge cases

The simpler approach trusts the agent to stop when appropriate.

---

## Post-Removal Discovery: Token Overflow Issue

After removing the completion MCP system, we observed tasks failing with token limit errors:
- `"prompt is too long: 204762 tokens > 200000 maximum"` (Anthropic)
- `"Quota exceeded... limit: 1000000"` (Google Gemini)
- `"You requested up to 32000 tokens, but can only afford 13102"` (OpenRouter credit limit)

### Root Cause Analysis

**The token overflow was NOT caused by removing completion MCP.** It was a pre-existing issue that the completion system was accidentally masking.

#### How Completion MCP Was Hiding the Problem

The completion enforcement system included **session resumption** mechanisms:
1. When agent called `complete_task(success)` → spawned NEW verification session
2. When agent stopped without `complete_task` → spawned NEW continuation session
3. Each new session started with a **fresh context window** (~16K base tokens)

This meant accumulated snapshots were **reset** between sessions. No single session ever grew large enough to hit limits.

#### After Removal

Now the agent runs in a **single continuous session**:
```
Step 1:  ~16K tokens (base)
Step 5:  ~57K tokens
Step 10: ~135K tokens
Step 15: ~230K tokens
Step 20: ~300K+ tokens → EXCEEDS LIMIT
```

**It's like a memory leak that was "fixed" by periodically restarting the app** - removing the restarts exposed the underlying leak.

### Token Accumulation Evidence

From actual task logs, we observed:

| Step | Input Tokens | Cache Read | Total Context |
|------|-------------|------------|---------------|
| 1 | 73 | 16,198 | ~16K |
| 7 | 134,896 | 0 | ~135K |
| 11 | 55,997 | 180,031 | ~236K |
| 20 | 10,648 | 298,718 | ~309K |

**Single-step spikes:**
- 268,796 tokens in ONE step
- 139,543 tokens in ONE step
- 134,896 tokens in ONE step

### What's Causing the Large Snapshots

Browser accessibility tree snapshots on complex pages (e.g., Zillow) contained:
- **Up to 5,538 elements** (ref=e5538)
- Full navigation menus with all nested links
- Image carousels (prev/next controls for each listing)
- All property listing cards with prices, details, agent info
- Google Maps embed with all controls
- Footer links repeated on every page

Even with `interactiveOnly` mode, pages have thousands of interactive elements.

---

## Industry Research: Snapshot Optimization Best Practices

### 1. Vercel's agent-browser
**Source:** https://paddo.dev/blog/agent-browser-context-efficiency/

- **"Snapshot + Refs"** approach: Returns only `@e1: button "Sign In"` instead of full tree
- Claims **93% context reduction** vs Playwright MCP
- Benchmark: 31K chars → 5.5K chars = **5.7x more efficient**

When they removed 80% of tools:
- Success rate: 80% → **100%**
- Steps required: **-42%**
- Execution: **3.5x faster**

### 2. browser-use Framework
**Source:** https://docs.browser-use.com/customize/agent/all-parameters

Key parameters:
```python
max_input_tokens: int = 8000      # Hard limit on input tokens
viewport_expansion: int = 0       # Only capture visible elements
paint_order_filtering: bool = True # Remove elements hidden behind others
```

### 3. D2Snap / Webfuse
**Source:** https://www.webfuse.com/blog/dom-downsampling-for-llm-based-web-agents

Adaptive downsampling algorithm:
```javascript
adaptiveD2Snap(dom, maxTokens: 4096, maxIterations: 5)
```
- Merges container elements (div, section) based on merge ratio
- TextRank algorithm for text content reduction
- Attribute scoring to drop low-value attributes
- Automatically adjusts to hit token budget

### 4. Playwright MCP Serialization
**Source:** https://www.zstack-cloud.com/blog/playwright-mcp-deep-dive-the-perfect-combination-of-large-language-models-and-browser-automation/

- YAML-style format optimized for LLMs
- Only includes: role, name, URL, and ref ID
- Stable element positioning with refs

---

## Current Implementation Gap Analysis

**What `dev-browser-mcp` currently has:**
- ✅ `interactiveOnly` option (skips non-interactive elements)
- ✅ `refs: "interactable"` (only refs for interactable elements)
- ✅ Snapshot diffing system
- ✅ `INTERACTIVE_ROLES` whitelist

**What's missing:**

| Feature | Industry Standard | Current Implementation |
|---------|-------------------|------------------------|
| Max elements limit | `max_elements: 500` | ❌ None |
| Token budget | `max_input_tokens: 8000` | ❌ None |
| Tree depth limit | 2-3 levels | ❌ Unlimited |
| Viewport filtering | `viewport_expansion: 0` | ❌ Captures all |
| Pattern deduplication | Skip repeated nav/footer | ❌ Captures all |
| Adaptive downsampling | Merge containers | ❌ None |

---

## Recommended Optimizations

Based on industry best practices:

1. **Add `maxElements` parameter**
   - Stop after N elements (default: 500-1000)
   - Prioritize interactive elements before truncating

2. **Add `maxTokens` parameter**
   - Estimate token count and truncate at budget
   - Use adaptive downsampling like D2Snap

3. **Add `maxDepth` parameter**
   - Limit tree nesting (default: 3-4 levels)
   - Flatten deeply nested structures

4. **Add viewport filtering**
   - Only capture elements currently visible
   - Option to expand viewport by N pixels

5. **Deduplicate patterns**
   - Track seen navigation/footer patterns
   - Skip if identical to previous page

6. **Merge generic containers**
   - Collapse nested divs/sections without semantic value
   - Preserve hierarchy while reducing node count

---

## Will Optimizations Hurt Agent Performance?

**No, if implemented carefully.** Industry data shows *better* completion rates with curated context:

| Metric | Before Optimization | After Optimization |
|--------|--------------------|--------------------|
| Success rate | 80% | 100% |
| Steps required | Baseline | -42% |
| Execution speed | Baseline | 3.5x faster |
| Context usage | 31K chars | 5.5K chars |

**Why less context = better performance:**
1. **Signal-to-noise ratio** - Agent finds targets faster without irrelevant elements
2. **Attention efficiency** - LLMs have finite attention; flooding dilutes it
3. **Reduced hallucination** - Smaller context = less chance of confusion

**Risks to mitigate:**
- Make limits configurable per-action
- Start conservative and tune down
- Allow "full snapshot" fallback when agent is stuck
- Prioritize interactive elements before truncating
