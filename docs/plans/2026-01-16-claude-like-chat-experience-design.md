# Claude-Like Chat Experience Design

Improve chat interactions to feel more like Claude's web app: collapsible activity rows and consistent agent personality across all providers.

## Goals

1. **Collapsible activity rows** - Replace inline "Thinking..." with expandable cards showing tool activity
2. **Consistent personality** - Same communication style regardless of LLM provider (Anthropic, OpenAI, Google, xAI, Ollama)

---

## Part 1: Collapsible Activity Rows (UI)

### Collapsed State - Smart Adaptive Summary

| Context | Display |
|---------|---------|
| Single file | "Reading `src/components/Button.tsx`" |
| Multiple files | "Reading 3 files" |
| Website navigation | "Navigating to `google.com`" |
| Search | "Searching for `error handling`" |
| Command | "Running `npm test`" |
| Thinking | "Thinking..." |

### Expanded State - Full Details

- List of all file paths
- Command + output
- Tool parameters (JSON)
- For web: URL + page title

### Visual Structure

```
┌─────────────────────────────────────────────┐
│ ▶ Reading 3 files                      [···]│  ← Collapsed
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ ▼ Reading 3 files                           │  ← Expanded
├─────────────────────────────────────────────┤
│ • src/components/Button.tsx                 │
│ • src/components/Card.tsx                   │
│ • src/lib/utils.ts                          │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ // Button.tsx content preview...        │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Component: ActivityRow

```typescript
// src/renderer/components/execution/ActivityRow.tsx

interface ActivityRowProps {
  tool: string;           // "Read", "Bash", "WebFetch", etc.
  input: unknown;         // Tool parameters
  output?: string;        // Tool result (when complete)
  status: 'running' | 'complete';
}

function getSummary(tool: string, input: unknown): string {
  switch (tool) {
    case 'Read':
      const files = Array.isArray(input.files) ? input.files : [input.file_path];
      return files.length > 1
        ? `Reading ${files.length} files`
        : `Reading \`${basename(files[0])}\``;
    case 'WebFetch':
      return `Navigating to \`${new URL(input.url).hostname}\``;
    case 'Grep':
      return `Searching for \`${input.pattern}\``;
    case 'Bash':
      return input.description || `Running command`;
    default:
      return TOOL_PROGRESS_MAP[tool]?.label || tool;
  }
}
```

### Integration with Execution.tsx

```tsx
// Before: filter out tools, render all as MessageBubble
{messages.filter(m => m.type !== 'tool').map(m => <MessageBubble ... />)}

// After: render different component based on type
{messages.map(m =>
  m.type === 'tool'
    ? <ActivityRow key={m.id} tool={m.toolName} input={m.toolInput} ... />
    : <MessageBubble key={m.id} ... />
)}
```

### State

- `expandedRows: Set<string>` - local component state (not Zustand)
- Collapse/expand with framer-motion AnimatePresence
- Spinner while running, checkmark when complete

---

## Part 2: Consistent Agent Personality

### Problem

Different LLMs have different default personalities. Switching providers changes the feel of the interaction.

### Solution

Add personality and behavior rules to system prompt in `config-generator.ts`.

### System Prompt Additions

Add after `<capabilities>`, before `<important name="filesystem-rules">`:

```xml
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
```

---

## Files to Change

### UI Changes

| File | Change |
|------|--------|
| `src/renderer/components/execution/ActivityRow.tsx` | **New** - Collapsible row component |
| `src/renderer/pages/Execution.tsx` | Render `ActivityRow` for tool messages |

### Behavior Changes

| File | Change |
|------|--------|
| `src/main/opencode/config-generator.ts` | Add `<personality>` and `<critical name="asking-questions">` to system prompt |

---

## Implementation Order

1. Add system prompt sections (quick win, immediate behavior improvement)
2. Create ActivityRow component
3. Integrate into Execution.tsx
4. Test with multiple providers (Anthropic, OpenAI, Google, xAI)
