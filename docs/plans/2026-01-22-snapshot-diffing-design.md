# Snapshot Diffing Design

**Date:** 2026-01-22
**Status:** Approved
**Branch:** fix/prompt-size-limit

## Problem Statement

Browser automation tasks hit the 200K token limit primarily due to accumulated browser snapshots. Each snapshot is ~3K tokens (interactive-only) or ~20K tokens (full). Over a multi-step task, these accumulate and eventually exceed the limit.

### Constraints

- Cannot modify OpenCode CLI (npm dependency v1.1.16)
- Cannot truncate snapshots - agent needs complete element refs
- Cannot use separate LLM for summarization (unknown API key availability)
- Must not hurt agent performance/task success rate
- OpenCode manages conversation history server-side

### Key Insight

We control the **dev-browser-mcp server**, which generates all snapshot responses. By making each response smaller at generation time, we reduce what goes into conversation history in the first place.

## Solution Architecture

### Smart Snapshot Diffing

The dev-browser-mcp server maintains state across calls within a session. We track snapshot history and automatically return diffs when beneficial.

```
┌─────────────────────────────────────────────────────────────┐
│                    dev-browser-mcp server                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SnapshotManager (new)                   │   │
│  │  - lastSnapshot: ParsedSnapshot                      │   │
│  │  - lastUrl: string                                   │   │
│  │  - lastTimestamp: number                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            browser_snapshot() call                   │   │
│  │                                                      │   │
│  │  1. Capture current snapshot                         │   │
│  │  2. Compare URL with lastUrl                         │   │
│  │  3. If same page → compute diff                      │   │
│  │  4. If new page → return full snapshot               │   │
│  │  5. Update lastSnapshot state                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Same-Page Detection

- Compare URL (ignoring hash fragments for SPAs)
- Compare page title
- Compare key structural elements (main landmarks)

## Tool API Changes

### Modified `browser_snapshot` parameters

```typescript
browser_snapshot({
  interactive_only?: boolean,  // existing - default: true
  full_snapshot?: boolean,     // NEW - force full snapshot, ignoring diff logic
})
```

### Behavior Matrix

| Scenario | Default behavior | Override |
|----------|-----------------|----------|
| First snapshot on page | Full snapshot | N/A |
| Same page, subsequent call | Return diff only | `full_snapshot: true` → full |
| New page detected | Full snapshot | N/A |
| Agent explicitly requests | Diff (default) | `full_snapshot: true` → full |

### When agent should use `full_snapshot: true`

- After significant page mutations (modal opened, dynamic content loaded)
- When element refs from diff don't seem to match expected state
- When agent needs complete context to understand the page

### Updated Tool Description

```
browser_snapshot - Capture page structure as ARIA accessibility tree

Parameters:
- interactive_only (boolean, default: true): Only include interactive elements
- full_snapshot (boolean, default: false): Force complete snapshot.
  By default, returns a diff if the page hasn't changed since last snapshot.
  Use this when you need complete context or after major page changes.

Returns: YAML snapshot with element refs, or diff showing only changes.
```

## Implementation Details

### File Structure

```
apps/desktop/skills/dev-browser-mcp/src/
├── index.ts                    # existing - main MCP server
├── snapshot/
│   ├── browser-script.ts       # existing - browser-side capture
│   ├── snapshot-manager.ts     # NEW - tracks state, computes diffs
│   └── snapshot-differ.ts      # NEW - diff algorithm
```

### SnapshotManager Class

```typescript
class SnapshotManager {
  private lastSnapshot: ParsedSnapshot | null = null;
  private lastUrl: string | null = null;
  private lastTitle: string | null = null;

  processSnapshot(
    currentSnapshot: ParsedSnapshot,
    currentUrl: string,
    currentTitle: string,
    options: { fullSnapshot?: boolean }
  ): SnapshotResult {

    // Force full if requested or first snapshot
    if (options.fullSnapshot || !this.lastSnapshot) {
      this.updateState(currentSnapshot, currentUrl, currentTitle);
      return { type: 'full', content: currentSnapshot };
    }

    // Check if same page
    if (this.isSamePage(currentUrl, currentTitle)) {
      const diff = this.computeDiff(this.lastSnapshot, currentSnapshot);
      this.updateState(currentSnapshot, currentUrl, currentTitle);
      return { type: 'diff', content: diff, unchangedRefs: diff.unchangedRefs };
    }

    // New page - return full
    this.updateState(currentSnapshot, currentUrl, currentTitle);
    return { type: 'full', content: currentSnapshot };
  }

  private isSamePage(url: string, title: string): boolean {
    // Compare normalized URLs (strip hash, query params for SPA detection)
    const normalizedCurrent = this.normalizeUrl(url);
    const normalizedLast = this.normalizeUrl(this.lastUrl);
    return normalizedCurrent === normalizedLast;
  }
}
```

### Diff Algorithm

- Parse both snapshots into element maps keyed by ref
- Compare element properties (role, name, value, disabled, checked, etc.)
- Output: unchanged refs list + changed elements with before/after

## Output Format

### Full Snapshot (~3K tokens)

```yaml
- Page URL: https://app.example.com/checkout
- Page Title: Checkout - Example Store

- ref: e1
  role: banner
  name: "Header"
  children:
    - ref: e2
      role: link
      name: "Logo"
    # ... 50+ elements
```

### Diff Output (~300-500 tokens)

```yaml
[Same page: Checkout - Example Store]
[URL: https://app.example.com/checkout]
[Unchanged: e1-e31, e35-e60]

Changed:
- ref: e32
  role: textbox
  name: "Card Number"
  value: "4242424242424242"  # previously: ""

- ref: e33
  role: textbox
  name: "Expiry"
  value: "12/25"  # previously: ""

- ref: e40
  role: button
  name: "Pay Now"
  disabled: false  # previously: true
```

## Token Savings Estimate

| Scenario | Without diff | With diff | Savings |
|----------|-------------|-----------|---------|
| 5 snapshots, same page | 15K tokens | 3K + 2K (4 diffs) = 5K | 67% |
| 10 snapshots, same page | 30K tokens | 3K + 4.5K = 7.5K | 75% |
| 10 snapshots, 3 pages | 30K tokens | 9K + 3K = 12K | 60% |

## Edge Cases & Error Handling

| Situation | Behavior |
|-----------|----------|
| SPA navigation (URL hash change) | Detect via title change or major DOM changes → full snapshot |
| Modal/dialog opens | Elements added, structure change detected → include new elements in diff |
| Page refresh (same URL) | Timestamp check + element count comparison → full snapshot if significantly different |
| Element refs change (React re-render) | Detect ref mismatches → fall back to full snapshot |
| Agent uses stale ref from diff | Browser tool returns "element not found" → agent can request `full_snapshot: true` |

### Safeguards

1. **Diff sanity check**: If >70% of elements changed, return full snapshot instead
2. **Ref continuity**: Track if element refs are stable, detect re-assignment
3. **Timeout reset**: If >30 seconds between snapshots, return full snapshot
4. **Agent hint in diff output**: Include guidance for using `full_snapshot: true`

### State Reset Triggers

- On `browser_navigate` → clear snapshot state
- On page crash/reload detection → clear state
- On explicit `full_snapshot: true` → state updated with full snapshot

## Testing Strategy

### Unit Tests (snapshot-differ.ts)

- Diff two identical snapshots → empty diff, all refs unchanged
- Diff with one changed element → correct change detected
- Diff with new elements added → new elements in output
- Diff with elements removed → removed elements noted
- Diff with >70% changes → returns null (triggers full snapshot)

### Integration Tests (SnapshotManager)

- Same page, multiple snapshots → diffs returned
- Navigate to new page → full snapshot returned
- `full_snapshot: true` override → full snapshot returned
- SPA hash navigation → appropriate detection

### E2E Tests

Test prompts:
1. "Go to a login page, fill in the email field, then fill in the password field"
2. "Go to a complex page with dynamic content, take multiple snapshots"
3. Long multi-step task that previously failed with token limit

## Implementation Order

1. Create `snapshot-differ.ts` with diff algorithm
2. Create `snapshot-manager.ts` with state tracking
3. Integrate into `browser_snapshot` handler in `index.ts`
4. Add `full_snapshot` parameter to tool schema
5. Update tool description for agent awareness
6. Write unit tests for differ
7. Write integration tests for manager
8. E2E test with real prompts
9. Monitor token usage and success rate

## Success Criteria

- 60%+ reduction in tokens for same-page interactions
- No increase in task failure rate
- Agent can override with `full_snapshot: true` when needed
- Clean fallback to full snapshots on edge cases
