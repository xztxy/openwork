# Task Planning & Verification Design

**Date:** 2026-01-21
**Status:** Ready for implementation

## Problem

The browser agent stops mid-task without completing. The `complete_task` enforcement catches this and nudges continuation, but the agent lacks a clear sense of what "done" means before starting.

## Solution

Update the system prompt to require the agent to:
1. **Plan first** - Before any action, output a numbered plan with steps and completion criteria
2. **Execute** - Work through the steps
3. **Verify before completing** - When calling `complete_task`, review each step's completion criteria

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| When to plan | Always | Consistency, forces thinking before acting |
| Plan contents | Steps + completion criteria | Enough structure without over-engineering |
| Verification timing | End of task | Simpler than per-step verification, integrates with `complete_task` |
| Plan storage | Conversation context | No new tools/state needed, just prompt engineering |

## Implementation

### File to Modify

`apps/desktop/src/main/opencode/config-generator.ts`

### Prompt Addition

Add to `ACCOMPLISH_SYSTEM_PROMPT_TEMPLATE` before the existing `<behavior>` section:

```xml
<behavior name="task-planning">
**TASK PLANNING - REQUIRED FOR EVERY TASK**

Before taking ANY action, you MUST first output a plan:

1. **State the goal** - What the user wants accomplished
2. **List steps with verification** - Numbered steps, each with a completion criterion

Format:
**Plan:**
Goal: [what user asked for]

Steps:
1. [Action] → verify: [how to confirm it's done]
2. [Action] → verify: [how to confirm it's done]
...

Then execute the steps. When calling `complete_task`:
- Review each step's verification criterion
- Only use status "success" if ALL criteria are met
- Use "partial" if some steps incomplete, list which ones in `remaining_work`

**Example:**
Goal: Extract analytics data from a website

Steps:
1. Navigate to URL → verify: page title contains expected text
2. Locate data section → verify: can see the target metrics
3. Extract values → verify: have captured specific numbers
4. Report findings → verify: summary includes all extracted data
</behavior>
```

### Expected Agent Output

```
Task: Go to Google Analytics and extract user data

**Plan:**
Goal: Extract interesting user behavior data from Google Analytics

Steps:
1. Navigate to the Analytics URL → verify: page loads with "Analytics" in title
2. Find user behavior data → verify: can see metrics like Active Users, Events
3. Extract key metrics → verify: have at least 3 data points captured
4. Summarize findings → verify: summary includes the extracted data

Let me start with step 1...
```

## Integration

Works with existing systems:
- **`complete_task` enforcement** - Still functions as safety net if agent stops without completing
- **`complete_task` tool schema** - Already has `original_request_summary` and `remaining_work` fields for verification
- **Continuation prompt** - Still triggers if agent stops without calling `complete_task`
- **Screenshot verification** - New verification step when agent claims success (see below)

## Screenshot-Based Verification (New)

When the agent calls `complete_task` with `status="success"`, the system does not immediately accept the completion. Instead:

1. **Capture args** - Store the agent's claimed `summary` and `original_request_summary`
2. **Resume session** - Start a verification session with a prompt asking the agent to:
   - Take a screenshot of the current browser state
   - Review the plan's completion criteria
   - Compare the screenshot against each criterion
3. **Re-confirm or continue** - Agent must either:
   - Call `complete_task` again with `status="success"` if ALL criteria are visually confirmed
   - Continue working if any criteria are NOT met

### Verification Prompt

```
VERIFICATION REQUIRED.

You claimed to have completed the task with this summary:
"[agent's claimed summary]"

The original request was:
"[original request summary]"

Before I accept completion, you MUST verify your work:

1. Take a screenshot of the current browser state using the browser tool
2. Review your plan's completion criteria
3. Compare the screenshot against each criterion

Then either:
- If ALL criteria are met: Call complete_task again with status="success"
- If ANY criteria are NOT met: Continue working to complete them

Do NOT call complete_task with success unless the screenshot proves the task is done.
```

### Implementation in adapter.ts

New state variables:
- `pendingVerification: boolean` - Flag to trigger verification after process exit
- `awaitingVerification: boolean` - Tracks if we're in verification mode
- `completeTaskArgs` - Stores the arguments from the `complete_task` call

Flow:
1. Agent calls `complete_task` with `status="success"`
2. `completeTaskCalled = true`, args stored, `pendingVerification = true`, `awaitingVerification = true`
3. On process exit, `startVerificationTask()` is called instead of completing
4. Verification session resumes with the verification prompt
5. If agent calls `complete_task` again with success → task completes
6. If agent continues working → loop continues with continuation mechanism

## Changes Required

- `adapter.ts` - Added screenshot-based verification mechanism
- `config-generator.ts` - Added task planning behavior
- `complete-task` MCP tool - Schema unchanged

## Testing

1. Manual testing with browser automation tasks
2. Verify agent outputs plan before taking actions
3. Verify agent references plan criteria in `complete_task` summary
4. Verify partial completion correctly identifies incomplete steps
5. **Verify screenshot verification triggers when agent claims success**
6. **Verify agent takes screenshot and compares against criteria before re-confirming**

## Rollback

- Remove the `<behavior name="task-planning">` section from the system prompt
- Remove verification logic from `adapter.ts` (revert `pendingVerification`, `awaitingVerification`, `completeTaskArgs`, and `startVerificationTask`)
