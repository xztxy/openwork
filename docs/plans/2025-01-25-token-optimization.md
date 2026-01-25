# Token Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce browser snapshot token usage from 50K+ to ~8K tokens per snapshot through aggressive filtering, token budgeting, and context management.

**Architecture:** 3-tier optimization system: (1) Element filtering with priority scoring and maxElements limit, (2) Token budget system with estimation and truncation, (3) Context management with session history. Each tier is independent and additive.

**Tech Stack:** TypeScript, Playwright, YAML generation, MCP server tools

---

## Key Files Reference

| Purpose | Path |
|---------|------|
| **MCP server + inlined SNAPSHOT_SCRIPT** | `apps/desktop/skills/dev-browser-mcp/src/index.ts` |
| Snapshot manager | `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts` |
| Type definitions | `apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts` |
| YAML parser | `apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.ts` |
| Diff logic | `apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.ts` |
| Manager tests | `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts` |

> **Important:** The actual snapshot script is an **inlined constant** (`SNAPSHOT_SCRIPT`) in `index.ts`, not a separate file. The script is injected into the browser via `page.evaluate()`. Any modifications to snapshot generation must be made directly in the inlined script.

---

## Phase 1: Aggressive Filtering (P0)

### Task 1: Add Priority Scoring Types

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts`

**Step 1: Add new types to types.ts**

Add after the existing `SnapshotElement` interface (around line 19):

```typescript
/**
 * Priority scoring for elements during snapshot truncation.
 * Higher scores = more likely to be included.
 */
export interface ElementPriority {
  ref: string;
  score: number;
  inViewport: boolean;
}

/**
 * Metadata about snapshot truncation.
 */
export interface SnapshotMetadata {
  totalElements: number;
  includedElements: number;
  truncated: boolean;
  estimatedTokens: number;
}
```

**Step 2: Update ParsedSnapshot interface**

Modify `ParsedSnapshot` interface to include metadata:

```typescript
export interface ParsedSnapshot {
  url: string;
  title: string;
  timestamp: number;
  elements: Map<string, SnapshotElement>;
  rawYaml: string;
  metadata?: SnapshotMetadata;  // NEW
}
```

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): add priority scoring and metadata types

Add ElementPriority interface for element scoring during truncation.
Add SnapshotMetadata interface to track truncation info.
Update ParsedSnapshot to include optional metadata.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add SnapshotOptions Interface

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts`

**Step 1: Add SnapshotOptions interface**

Add after the new types from Task 1:

```typescript
/**
 * Options for snapshot generation and processing.
 */
export interface SnapshotOptions {
  /** Return all elements without filtering. Default: false */
  fullSnapshot?: boolean;
  /** Only include interactive elements. Default: true */
  interactiveOnly?: boolean;
  /** Maximum number of elements to include. Default: 300, max: 1000 */
  maxElements?: number;
  /** Only include elements visible in viewport. Default: false */
  viewportOnly?: boolean;
  /** Maximum estimated tokens for output. Default: 8000, max: 50000 */
  maxTokens?: number;
  /** Include session navigation history in output. Default: true */
  includeHistory?: boolean;
}

/** Default values for snapshot options */
export const DEFAULT_SNAPSHOT_OPTIONS: Required<SnapshotOptions> = {
  fullSnapshot: false,
  interactiveOnly: true,
  maxElements: 300,
  viewportOnly: false,
  maxTokens: 8000,
  includeHistory: true,
};
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): add SnapshotOptions interface with defaults

Define options for controlling snapshot generation:
- maxElements (default 300)
- maxTokens (default 8000)
- viewportOnly, includeHistory flags

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Write Failing Test for Priority Scoring

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.test.ts`

**Step 1: Create test file**

```typescript
import { describe, it, expect } from 'vitest';
import { getElementPriority, ROLE_PRIORITIES } from './priority';

describe('priority scoring', () => {
  describe('getElementPriority', () => {
    it('should score buttons highest', () => {
      const score = getElementPriority('button', true);
      expect(score).toBe(150); // 100 base + 50 viewport bonus
    });

    it('should score textbox high', () => {
      const score = getElementPriority('textbox', true);
      expect(score).toBe(145); // 95 base + 50 viewport bonus
    });

    it('should give viewport bonus', () => {
      const inViewport = getElementPriority('link', true);
      const outViewport = getElementPriority('link', false);
      expect(inViewport - outViewport).toBe(50);
    });

    it('should default unknown roles to 50', () => {
      const score = getElementPriority('unknown-role', false);
      expect(score).toBe(50);
    });

    it('should score navigation lower than primary inputs', () => {
      const navigation = getElementPriority('navigation', false);
      const button = getElementPriority('button', false);
      expect(button).toBeGreaterThan(navigation);
    });
  });

  describe('ROLE_PRIORITIES', () => {
    it('should define priorities for all interactive roles', () => {
      const interactiveRoles = [
        'button', 'link', 'textbox', 'checkbox', 'radio',
        'combobox', 'listbox', 'option', 'tab', 'menuitem',
      ];
      for (const role of interactiveRoles) {
        expect(ROLE_PRIORITIES[role]).toBeDefined();
        expect(ROLE_PRIORITIES[role]).toBeGreaterThan(0);
      }
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/priority.test.ts`

Expected: FAIL with "Cannot find module './priority'"

**Step 3: Commit failing test**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.test.ts
git commit -m "$(cat <<'EOF'
test(snapshot): add failing tests for priority scoring

Tests for getElementPriority function:
- Role-based scoring (button=100, textbox=95, etc.)
- Viewport bonus (+50)
- Unknown role default (50)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Implement Priority Scoring Module

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.ts`

**Step 1: Create priority.ts**

```typescript
/**
 * Priority scoring for snapshot elements.
 * Higher priority elements are kept when truncating snapshots.
 */

/**
 * Base priority scores by ARIA role.
 * Primary interactive elements score highest.
 */
export const ROLE_PRIORITIES: Record<string, number> = {
  // Primary inputs - highest priority
  button: 100,
  textbox: 95,
  searchbox: 95,

  // Form controls
  checkbox: 90,
  radio: 90,
  switch: 90,
  combobox: 85,
  listbox: 85,
  slider: 85,
  spinbutton: 85,

  // Navigation
  link: 80,
  tab: 75,
  menuitem: 70,
  menuitemcheckbox: 70,
  menuitemradio: 70,
  option: 70,

  // Containers (lower priority - often redundant)
  navigation: 60,
  menu: 60,
  tablist: 55,
  form: 50,
  dialog: 50,
  alertdialog: 50,
};

/** Viewport visibility bonus */
const VIEWPORT_BONUS = 50;

/** Default priority for unknown roles */
const DEFAULT_PRIORITY = 50;

/**
 * Calculate priority score for an element.
 * @param role - ARIA role of the element
 * @param inViewport - Whether element is visible in viewport
 * @returns Priority score (higher = more important)
 */
export function getElementPriority(role: string, inViewport: boolean): number {
  const basePriority = ROLE_PRIORITIES[role] ?? DEFAULT_PRIORITY;
  return inViewport ? basePriority + VIEWPORT_BONUS : basePriority;
}
```

**Step 2: Run test to verify it passes**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/priority.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): implement priority scoring for elements

Add getElementPriority function with role-based scoring:
- button/textbox: 100/95 (primary inputs)
- checkbox/radio/switch: 90 (form controls)
- link/tab: 80/75 (navigation)
- Viewport bonus: +50

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Write Failing Test for Element Truncation

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.test.ts`

**Step 1: Add truncation tests**

Add to the existing test file:

```typescript
import { truncateElements, type TruncatableElement } from './priority';

describe('truncateElements', () => {
  const createElements = (count: number, role = 'button', inViewport = true): TruncatableElement[] => {
    return Array.from({ length: count }, (_, i) => ({
      ref: `e${i + 1}`,
      role,
      name: `Element ${i + 1}`,
      inViewport,
    }));
  };

  it('should return all elements when under limit', () => {
    const elements = createElements(5);
    const result = truncateElements(elements, { maxElements: 10 });
    expect(result.elements).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it('should truncate to maxElements', () => {
    const elements = createElements(100);
    const result = truncateElements(elements, { maxElements: 50 });
    expect(result.elements).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.totalElements).toBe(100);
  });

  it('should prioritize viewport elements', () => {
    const inViewport = createElements(5, 'button', true);
    const outViewport = createElements(5, 'button', false);
    const mixed = [...outViewport, ...inViewport]; // Out of viewport first

    const result = truncateElements(mixed, { maxElements: 5 });

    // Should keep all viewport elements
    expect(result.elements.every(e => e.inViewport)).toBe(true);
  });

  it('should prioritize by role', () => {
    const buttons = createElements(3, 'button', false);
    const links = createElements(3, 'link', false);
    const navs = createElements(3, 'navigation', false);
    const mixed = [...navs, ...links, ...buttons]; // Lowest priority first

    const result = truncateElements(mixed, { maxElements: 3 });

    // Should keep buttons (highest priority)
    expect(result.elements.every(e => e.role === 'button')).toBe(true);
  });

  it('should return metadata about truncation', () => {
    const elements = createElements(100);
    const result = truncateElements(elements, { maxElements: 30 });

    expect(result.totalElements).toBe(100);
    expect(result.includedElements).toBe(30);
    expect(result.truncated).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/priority.test.ts`

Expected: FAIL with "truncateElements is not exported"

**Step 3: Commit failing test**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.test.ts
git commit -m "$(cat <<'EOF'
test(snapshot): add failing tests for element truncation

Tests for truncateElements function:
- Returns all when under limit
- Truncates to maxElements
- Prioritizes viewport elements
- Prioritizes by role
- Returns truncation metadata

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Implement Element Truncation

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.ts`

**Step 1: Add TruncatableElement type and truncateElements function**

Add to priority.ts:

```typescript
import type { SnapshotMetadata } from './types';

/**
 * Element with viewport info for truncation.
 */
export interface TruncatableElement {
  ref: string;
  role: string;
  name: string;
  inViewport: boolean;
  [key: string]: unknown;
}

/**
 * Options for element truncation.
 */
export interface TruncateOptions {
  maxElements?: number;
}

/**
 * Result of element truncation.
 */
export interface TruncateResult<T extends TruncatableElement> {
  elements: T[];
  totalElements: number;
  includedElements: number;
  truncated: boolean;
}

/**
 * Truncate elements to maxElements, prioritizing by role and viewport.
 * @param elements - Elements to truncate
 * @param options - Truncation options
 * @returns Truncated elements with metadata
 */
export function truncateElements<T extends TruncatableElement>(
  elements: T[],
  options: TruncateOptions
): TruncateResult<T> {
  const maxElements = options.maxElements ?? 300;
  const totalElements = elements.length;

  if (totalElements <= maxElements) {
    return {
      elements,
      totalElements,
      includedElements: totalElements,
      truncated: false,
    };
  }

  // Score and sort elements by priority (descending)
  const scored = elements.map(element => ({
    element,
    score: getElementPriority(element.role, element.inViewport),
  }));

  scored.sort((a, b) => b.score - a.score);

  const truncatedElements = scored.slice(0, maxElements).map(s => s.element);

  return {
    elements: truncatedElements,
    totalElements,
    includedElements: maxElements,
    truncated: true,
  };
}
```

**Step 2: Run test to verify it passes**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/priority.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/priority.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): implement element truncation with priority

Add truncateElements function:
- Scores elements by role + viewport visibility
- Sorts by priority (descending)
- Truncates to maxElements
- Returns metadata (totalElements, truncated flag)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Export Priority Module from Snapshot Index

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts`

**Step 1: Add export**

Add to the exports in index.ts:

```typescript
export * from './priority';
```

**Step 2: Verify exports work**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): export priority module

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Update Browser Script Options Interface

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Find and update SnapshotOptions interface**

The browser script has its own SnapshotOptions at line ~1288. Update it to include new parameters:

```typescript
interface SnapshotOptions {
  interactiveOnly?: boolean;
  maxElements?: number;      // NEW
  viewportOnly?: boolean;    // NEW
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop/skills/dev-browser && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): add maxElements and viewportOnly options

Extend browser script SnapshotOptions interface with:
- maxElements: limit number of elements returned
- viewportOnly: filter to viewport-visible elements

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Add Viewport Detection to Browser Script

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Add viewport detection helper**

Add this function near other helper functions (around line 1100):

```typescript
/**
 * Check if an element is visible within the viewport.
 */
function isInViewport(box: { x: number; y: number; width: number; height: number } | undefined): boolean {
  if (!box || box.width === 0 || box.height === 0) return false;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Element is in viewport if any part is visible
  return (
    box.x < viewportWidth &&
    box.y < viewportHeight &&
    box.x + box.width > 0 &&
    box.y + box.height > 0
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): add viewport detection helper

Add isInViewport function to check if element bounding box
intersects with the current viewport.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add Priority Scoring to Browser Script

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Add priority scoring constants and function**

Add after the viewport helper:

```typescript
/**
 * Priority scores by ARIA role (matches server-side scoring).
 */
const ROLE_PRIORITIES: Record<string, number> = {
  button: 100,
  textbox: 95,
  searchbox: 95,
  checkbox: 90,
  radio: 90,
  switch: 90,
  combobox: 85,
  listbox: 85,
  slider: 85,
  spinbutton: 85,
  link: 80,
  tab: 75,
  menuitem: 70,
  menuitemcheckbox: 70,
  menuitemradio: 70,
  option: 70,
  navigation: 60,
  menu: 60,
  tablist: 55,
  form: 50,
  dialog: 50,
  alertdialog: 50,
};

const VIEWPORT_BONUS = 50;
const DEFAULT_PRIORITY = 50;

/**
 * Calculate priority score for element truncation.
 */
function getElementPriority(role: string, inViewport: boolean): number {
  const basePriority = ROLE_PRIORITIES[role] ?? DEFAULT_PRIORITY;
  return inViewport ? basePriority + VIEWPORT_BONUS : basePriority;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): add priority scoring for element truncation

Add ROLE_PRIORITIES constant and getElementPriority function
matching server-side scoring logic.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Implement Element Collection with Scoring

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Add element collection interface and function**

Add after priority scoring:

```typescript
interface ScoredElement {
  node: AriaNode;
  score: number;
  inViewport: boolean;
}

/**
 * Collect all elements with priority scores.
 */
function collectScoredElements(
  root: AriaNode,
  options: SnapshotOptions
): ScoredElement[] {
  const elements: ScoredElement[] = [];

  function visit(node: AriaNode): void {
    // Skip non-interactive if interactiveOnly
    const isInteractive = INTERACTIVE_ROLES.includes(node.role);
    if (options.interactiveOnly && !isInteractive) {
      // Still visit children
      for (const child of node.children ?? []) {
        if (typeof child !== 'string') visit(child);
      }
      return;
    }

    // Check viewport
    const inViewport = isInViewport(node.box);

    // Skip if viewportOnly and not in viewport
    if (options.viewportOnly && !inViewport) {
      // Still visit children (they might be in viewport)
      for (const child of node.children ?? []) {
        if (typeof child !== 'string') visit(child);
      }
      return;
    }

    // Score and collect
    const score = getElementPriority(node.role, inViewport);
    elements.push({ node, score, inViewport });

    // Visit children
    for (const child of node.children ?? []) {
      if (typeof child !== 'string') visit(child);
    }
  }

  visit(root);
  return elements;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): implement element collection with scoring

Add collectScoredElements function that:
- Traverses ARIA tree
- Scores elements by role + viewport
- Filters by interactiveOnly/viewportOnly options
- Returns scored elements for truncation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Implement Truncation in Browser Script

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Add truncation function**

Add after collectScoredElements:

```typescript
interface TruncationResult {
  elements: ScoredElement[];
  totalElements: number;
  truncated: boolean;
}

/**
 * Truncate elements to maxElements, keeping highest priority.
 */
function truncateToLimit(
  elements: ScoredElement[],
  maxElements: number
): TruncationResult {
  const totalElements = elements.length;

  if (totalElements <= maxElements) {
    return { elements, totalElements, truncated: false };
  }

  // Sort by score descending
  const sorted = [...elements].sort((a, b) => b.score - a.score);

  return {
    elements: sorted.slice(0, maxElements),
    totalElements,
    truncated: true,
  };
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): add element truncation function

Add truncateToLimit function that:
- Returns all elements if under limit
- Sorts by priority score
- Truncates to maxElements
- Returns metadata about truncation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Update renderAriaTree for Truncation

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Modify renderAriaTree to use truncation**

Find the `renderAriaTree` function (around line 1283) and update it to accept and use truncation options. The key change is to:

1. Collect all elements with scores using `collectScoredElements`
2. Truncate to `maxElements` if specified
3. Build YAML from truncated set
4. Add metadata header when truncated

Update the function signature and implementation:

```typescript
function renderAriaTree(
  snapshot: AriaSnapshotResult,
  options: SnapshotOptions = {}
): string {
  const maxElements = options.maxElements ?? 300;

  // Collect and score all elements
  const scoredElements = collectScoredElements(snapshot.root, options);

  // Truncate if needed
  const { elements: truncatedElements, totalElements, truncated } =
    truncateToLimit(scoredElements, maxElements);

  // Build set of refs to include
  const includedRefs = new Set(
    truncatedElements.map(e => e.node.ref).filter(Boolean)
  );

  // Build YAML lines
  const lines: string[] = [];

  // Add metadata header if truncated
  if (truncated) {
    lines.push(`# Elements: ${truncatedElements.length} of ${totalElements} (prioritized by interactivity)`);
  }

  // Render only included elements
  function visit(node: AriaNode, indent: number): void {
    // Skip if not in included set (and has a ref)
    if (node.ref && !includedRefs.has(node.ref)) {
      return;
    }

    // ... existing YAML rendering logic for the node ...
    // (This part integrates with existing visit/visitText functions)
  }

  visit(snapshot.root, 0);

  return lines.join('\n');
}
```

**Note to implementer:** The actual integration will require careful merging with the existing `visit` and `visitText` functions in `renderAriaTree`. The key principle is:
1. Collect all elements first with `collectScoredElements`
2. Build `includedRefs` set from truncated results
3. In the rendering loop, skip elements not in `includedRefs`

**Step 2: Test locally**

Run: `cd apps/desktop/skills/dev-browser && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): integrate truncation into renderAriaTree

Update renderAriaTree to:
- Collect and score elements
- Truncate to maxElements (default 300)
- Add metadata header when truncated
- Skip non-included elements in YAML output

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Update MCP Tool Schema

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts`

**Step 1: Update browser_snapshot input schema**

Find the browser_snapshot tool definition (around line 1592) and update the inputSchema:

```typescript
{
  name: 'browser_snapshot',
  description: 'Get ARIA accessibility tree with element refs like [ref=e5]. Returns prioritized elements within token budget.',
  inputSchema: {
    type: 'object',
    properties: {
      page_name: {
        type: 'string',
        description: 'Name of the page to snapshot. Default: "main"',
      },
      interactive_only: {
        type: 'boolean',
        description: 'Only include interactive elements. Default: true',
      },
      full_snapshot: {
        type: 'boolean',
        description: 'Force complete snapshot without limits. Default: false',
      },
      max_elements: {  // NEW
        type: 'number',
        description: 'Maximum elements to include (1-1000). Default: 300',
      },
      viewport_only: {  // NEW
        type: 'boolean',
        description: 'Only include elements visible in viewport. Default: false',
      },
    },
  },
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "$(cat <<'EOF'
feat(mcp): add max_elements and viewport_only to browser_snapshot

Update tool schema with new parameters:
- max_elements: limit elements (default 300, max 1000)
- viewport_only: filter to viewport-visible elements

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Update Tool Handler to Pass New Options

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts`

**Step 1: Update browser_snapshot handler**

Find the handler case (around line 2333) and update it to pass new options:

```typescript
case 'browser_snapshot': {
  const page_name = input.page_name ?? 'main';
  const interactive_only = input.interactive_only ?? true;
  const full_snapshot = input.full_snapshot ?? false;
  const max_elements = Math.min(Math.max(input.max_elements ?? 300, 1), 1000);
  const viewport_only = input.viewport_only ?? false;

  // ... existing page lookup code ...

  const rawSnapshot = await getAISnapshot(page, {
    interactiveOnly: interactive_only,
    maxElements: full_snapshot ? undefined : max_elements,  // Bypass limits if full
    viewportOnly: viewport_only,
  });

  // ... rest of handler ...
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "$(cat <<'EOF'
feat(mcp): pass max_elements and viewport_only to snapshot

Update browser_snapshot handler to:
- Parse and validate max_elements (1-1000, default 300)
- Pass viewport_only to snapshot function
- Bypass limits when full_snapshot=true

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Write Integration Test for Truncation

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/__tests__/snapshot.test.ts`

**Step 1: Add truncation integration test**

Add a new test case:

```typescript
test('should truncate to maxElements with priority', async ({ page }) => {
  // Navigate to a page with many elements
  await page.setContent(`
    <html>
      <body>
        ${Array.from({ length: 100 }, (_, i) => `<button>Button ${i}</button>`).join('')}
        ${Array.from({ length: 100 }, (_, i) => `<a href="#">Link ${i}</a>`).join('')}
      </body>
    </html>
  `);

  const snapshot = await getAISnapshot(page, { maxElements: 50 });

  // Should include truncation header
  expect(snapshot).toContain('# Elements:');
  expect(snapshot).toContain('of 200');

  // Should have at most 50 element lines (plus header)
  const elementLines = snapshot.split('\n').filter(line => line.match(/^\s*-\s+\w+/));
  expect(elementLines.length).toBeLessThanOrEqual(50);

  // Should prioritize buttons over links
  const buttonCount = elementLines.filter(line => line.includes('button')).length;
  const linkCount = elementLines.filter(line => line.includes('link')).length;
  expect(buttonCount).toBeGreaterThan(linkCount);
});
```

**Step 2: Run test**

Run: `cd apps/desktop/skills/dev-browser && pnpm test src/snapshot/__tests__/snapshot.test.ts`

Expected: Test passes (if implementation is correct) or fails with meaningful error

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/__tests__/snapshot.test.ts
git commit -m "$(cat <<'EOF'
test(browser): add integration test for element truncation

Test verifies:
- Truncation header is added
- Element count respects maxElements
- Buttons prioritized over links

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Token Budget System (P1)

### Task 17: Write Failing Test for Token Estimation

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/tokens.test.ts`

**Step 1: Create test file**

```typescript
import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateElementTokens } from './tokens';

describe('token estimation', () => {
  describe('estimateElementTokens', () => {
    it('should estimate basic element at ~15 tokens', () => {
      const tokens = estimateElementTokens({
        role: 'button',
        name: 'Submit',
        ref: 'e1',
      });
      // role (1) + name (2) + ref (2) + yaml overhead (5) + attributes (2-5)
      expect(tokens).toBeGreaterThanOrEqual(10);
      expect(tokens).toBeLessThanOrEqual(20);
    });

    it('should cap long names at 50 token contribution', () => {
      const shortName = estimateElementTokens({
        role: 'button',
        name: 'OK',
        ref: 'e1',
      });
      const longName = estimateElementTokens({
        role: 'button',
        name: 'A'.repeat(1000), // Very long name
        ref: 'e2',
      });
      // Difference should be at most 50 (capped)
      expect(longName - shortName).toBeLessThanOrEqual(50);
    });

    it('should add tokens for extra attributes', () => {
      const basic = estimateElementTokens({
        role: 'checkbox',
        name: 'Accept',
        ref: 'e1',
      });
      const withAttrs = estimateElementTokens({
        role: 'checkbox',
        name: 'Accept',
        ref: 'e1',
        checked: true,
        disabled: true,
      });
      expect(withAttrs).toBeGreaterThan(basic);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate YAML string tokens', () => {
      const yaml = `- button "Submit" [ref=e1]
- textbox "Email" [ref=e2]
- link "Home" [ref=e3]`;
      const tokens = estimateTokens(yaml);
      // ~15 tokens per element * 3 = ~45
      expect(tokens).toBeGreaterThanOrEqual(30);
      expect(tokens).toBeLessThanOrEqual(60);
    });

    it('should handle empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/tokens.test.ts`

Expected: FAIL with "Cannot find module './tokens'"

**Step 3: Commit failing test**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/tokens.test.ts
git commit -m "$(cat <<'EOF'
test(snapshot): add failing tests for token estimation

Tests for token estimation functions:
- Basic element ~15 tokens
- Long name capped at 50 token contribution
- Extra attributes add tokens
- YAML string estimation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Implement Token Estimation Module

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/tokens.ts`

**Step 1: Create tokens.ts**

```typescript
/**
 * Token estimation for snapshot output.
 * Uses heuristics calibrated against actual tokenizer results.
 */

import type { SnapshotElement } from './types';

/** Average characters per token (Claude tokenizer approximation) */
const CHARS_PER_TOKEN = 4;

/** Base tokens for YAML structure per element */
const YAML_OVERHEAD = 5;

/** Tokens for each boolean attribute */
const ATTRIBUTE_TOKENS = 2;

/** Maximum tokens from element name */
const MAX_NAME_TOKENS = 50;

/**
 * Estimate tokens for a single element.
 */
export function estimateElementTokens(element: Partial<SnapshotElement>): number {
  let tokens = YAML_OVERHEAD;

  // Role: usually 1-2 tokens
  tokens += Math.ceil((element.role?.length ?? 0) / CHARS_PER_TOKEN);

  // Name: capped contribution
  const nameLength = element.name?.length ?? 0;
  const nameTokens = Math.ceil(nameLength / CHARS_PER_TOKEN);
  tokens += Math.min(nameTokens, MAX_NAME_TOKENS);

  // Ref: usually 2 tokens ([ref=e123])
  tokens += 2;

  // Boolean attributes
  if (element.checked !== undefined) tokens += ATTRIBUTE_TOKENS;
  if (element.disabled !== undefined) tokens += ATTRIBUTE_TOKENS;
  if (element.expanded !== undefined) tokens += ATTRIBUTE_TOKENS;
  if (element.selected !== undefined) tokens += ATTRIBUTE_TOKENS;
  if (element.pressed !== undefined) tokens += ATTRIBUTE_TOKENS;

  // Value: additional tokens
  if (element.value) {
    const valueTokens = Math.ceil(element.value.length / CHARS_PER_TOKEN);
    tokens += Math.min(valueTokens, MAX_NAME_TOKENS);
  }

  return tokens;
}

/**
 * Estimate total tokens for YAML string.
 * Uses simple character-based heuristic.
 */
export function estimateTokens(yaml: string): number {
  if (!yaml) return 0;
  return Math.ceil(yaml.length / CHARS_PER_TOKEN);
}
```

**Step 2: Run test to verify it passes**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/tokens.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/tokens.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): implement token estimation module

Add token estimation functions:
- estimateElementTokens: per-element estimate
- estimateTokens: YAML string estimate
- Caps name contribution at 50 tokens
- Includes attribute overhead

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Export Tokens Module

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts`

**Step 1: Add export**

```typescript
export * from './tokens';
```

**Step 2: Verify build**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): export tokens module

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Add Token Budget to Browser Script

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Update SnapshotOptions interface**

Add maxTokens to the interface:

```typescript
interface SnapshotOptions {
  interactiveOnly?: boolean;
  maxElements?: number;
  viewportOnly?: boolean;
  maxTokens?: number;  // NEW
}
```

**Step 2: Add token estimation function**

Add to browser script:

```typescript
const CHARS_PER_TOKEN = 4;

/**
 * Estimate tokens for YAML output.
 */
function estimateYamlTokens(yaml: string): number {
  return Math.ceil(yaml.length / CHARS_PER_TOKEN);
}
```

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): add maxTokens option and estimation

Add token budget support:
- maxTokens option in SnapshotOptions
- estimateYamlTokens function for budget tracking

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Implement Token Budget Enforcement

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts`

**Step 1: Update truncation to use token budget**

Modify the `truncateToLimit` function or add a new function that considers both maxElements and maxTokens:

```typescript
interface TokenBudgetResult {
  elements: ScoredElement[];
  totalElements: number;
  estimatedTokens: number;
  truncated: boolean;
  truncationReason?: 'maxElements' | 'maxTokens';
}

/**
 * Truncate elements respecting both element count and token budget.
 */
function truncateWithBudget(
  elements: ScoredElement[],
  maxElements: number,
  maxTokens: number
): TokenBudgetResult {
  const totalElements = elements.length;

  // Sort by priority
  const sorted = [...elements].sort((a, b) => b.score - a.score);

  const included: ScoredElement[] = [];
  let tokenCount = 0;
  let truncationReason: 'maxElements' | 'maxTokens' | undefined;

  for (const element of sorted) {
    // Check element limit
    if (included.length >= maxElements) {
      truncationReason = 'maxElements';
      break;
    }

    // Estimate tokens for this element
    const elementYaml = renderSingleElement(element.node);
    const elementTokens = estimateYamlTokens(elementYaml);

    // Check token budget
    if (tokenCount + elementTokens > maxTokens) {
      truncationReason = 'maxTokens';
      break;
    }

    included.push(element);
    tokenCount += elementTokens;
  }

  return {
    elements: included,
    totalElements,
    estimatedTokens: tokenCount,
    truncated: included.length < totalElements,
    truncationReason,
  };
}

/**
 * Render a single element to YAML for token estimation.
 */
function renderSingleElement(node: AriaNode): string {
  const parts: string[] = [`- ${node.role}`];
  if (node.name) parts.push(`"${node.name}"`);
  if (node.ref) parts.push(`[ref=${node.ref}]`);
  // Add other attributes as in main render
  return parts.join(' ');
}
```

**Step 2: Update renderAriaTree to use token budget**

Modify the main render function to call `truncateWithBudget` instead of `truncateToLimit`:

```typescript
// In renderAriaTree:
const maxTokens = options.maxTokens ?? 8000;

const { elements: truncatedElements, totalElements, estimatedTokens, truncated, truncationReason } =
  truncateWithBudget(scoredElements, maxElements, maxTokens);

// Update header to include token info
if (truncated) {
  const reason = truncationReason === 'maxTokens' ? 'token budget' : 'element limit';
  lines.push(`# Elements: ${truncatedElements.length} of ${totalElements} (truncated: ${reason})`);
  lines.push(`# Tokens: ~${estimatedTokens}`);
}
```

**Step 3: Verify build**

Run: `cd apps/desktop/skills/dev-browser && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/browser-script.ts
git commit -m "$(cat <<'EOF'
feat(browser): implement token budget enforcement

Add truncateWithBudget function that:
- Respects both maxElements and maxTokens
- Estimates tokens per element
- Stops when budget exhausted
- Reports truncation reason in header

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Update MCP Tool Schema with maxTokens

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts`

**Step 1: Add max_tokens to schema**

Update the browser_snapshot inputSchema:

```typescript
max_tokens: {
  type: 'number',
  description: 'Maximum estimated tokens (1000-50000). Default: 8000',
},
```

**Step 2: Update handler to pass max_tokens**

```typescript
const max_tokens = Math.min(Math.max(input.max_tokens ?? 8000, 1000), 50000);

const rawSnapshot = await getAISnapshot(page, {
  interactiveOnly: interactive_only,
  maxElements: full_snapshot ? undefined : max_elements,
  maxTokens: full_snapshot ? undefined : max_tokens,
  viewportOnly: viewport_only,
});
```

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "$(cat <<'EOF'
feat(mcp): add max_tokens parameter to browser_snapshot

- Add max_tokens to schema (1000-50000, default 8000)
- Pass to snapshot function
- Bypass when full_snapshot=true

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Write Token Budget Integration Test

**Files:**
- Modify: `apps/desktop/skills/dev-browser/src/snapshot/__tests__/snapshot.test.ts`

**Step 1: Add token budget test**

```typescript
test('should respect maxTokens budget', async ({ page }) => {
  // Create page with many elements
  await page.setContent(`
    <html>
      <body>
        ${Array.from({ length: 500 }, (_, i) =>
          `<button>Button with a moderately long name ${i}</button>`
        ).join('')}
      </body>
    </html>
  `);

  // Request small token budget
  const snapshot = await getAISnapshot(page, { maxTokens: 2000 });

  // Should have token info in header
  expect(snapshot).toContain('# Tokens:');

  // Estimate actual tokens
  const estimatedTokens = Math.ceil(snapshot.length / 4);
  expect(estimatedTokens).toBeLessThanOrEqual(2500); // Allow some overhead
});
```

**Step 2: Run test**

Run: `cd apps/desktop/skills/dev-browser && pnpm test`

Expected: Test passes

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser/src/snapshot/__tests__/snapshot.test.ts
git commit -m "$(cat <<'EOF'
test(browser): add token budget integration test

Verify snapshot respects maxTokens parameter and
includes token estimate in header.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Context Management (P2)

### Task 24: Add Session History Types

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts`

**Step 1: Add session history types**

```typescript
/**
 * Entry in session navigation history.
 */
export interface SessionHistoryEntry {
  url: string;
  title: string;
  timestamp: number;
  actionsTaken: string[];
}

/**
 * Compact session summary for context.
 */
export interface SessionSummary {
  history: string;  // "Page A → Page B → Page C"
  pagesVisited: number;
  navigationPatternHash?: string;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): add session history types

Add types for context management:
- SessionHistoryEntry: per-page tracking
- SessionSummary: compact navigation history

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Write Failing Test for Session History

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts`

**Step 1: Add session history tests**

```typescript
describe('session history', () => {
  it('should track navigation history', () => {
    const manager = new SnapshotManager();

    manager.processSnapshot(yaml1, 'https://example.com/page1', 'Page 1', {});
    manager.processSnapshot(yaml2, 'https://example.com/page2', 'Page 2', {});
    manager.processSnapshot(yaml3, 'https://example.com/page3', 'Page 3', {});

    const summary = manager.getSessionSummary();
    expect(summary.history).toContain('Page 1');
    expect(summary.history).toContain('Page 2');
    expect(summary.history).toContain('Page 3');
    expect(summary.pagesVisited).toBe(3);
  });

  it('should limit history to 10 entries', () => {
    const manager = new SnapshotManager();

    for (let i = 0; i < 15; i++) {
      manager.processSnapshot(
        yaml1,
        `https://example.com/page${i}`,
        `Page ${i}`,
        {}
      );
    }

    const summary = manager.getSessionSummary();
    expect(summary.pagesVisited).toBe(10);
    expect(summary.history).not.toContain('Page 0');
    expect(summary.history).toContain('Page 14');
  });

  it('should reset history on manager reset', () => {
    const manager = new SnapshotManager();

    manager.processSnapshot(yaml1, 'https://example.com', 'Home', {});
    manager.reset();

    const summary = manager.getSessionSummary();
    expect(summary.pagesVisited).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/manager.test.ts`

Expected: FAIL - getSessionSummary doesn't exist

**Step 3: Commit failing test**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts
git commit -m "$(cat <<'EOF'
test(snapshot): add failing tests for session history

Tests for session history tracking:
- Tracks navigation between pages
- Limits history to 10 entries
- Resets on manager reset

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: Implement Session History in SnapshotManager

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts`

**Step 1: Add session history properties and methods**

Add imports:

```typescript
import type { SessionHistoryEntry, SessionSummary } from './types';
```

Add properties to SnapshotManager class:

```typescript
private sessionHistory: SessionHistoryEntry[] = [];
private readonly MAX_HISTORY_SIZE = 10;
```

Add method to record history:

```typescript
private recordNavigation(url: string, title: string): void {
  this.sessionHistory.push({
    url,
    title,
    timestamp: Date.now(),
    actionsTaken: [],
  });

  // Trim to max size
  if (this.sessionHistory.length > this.MAX_HISTORY_SIZE) {
    this.sessionHistory = this.sessionHistory.slice(-this.MAX_HISTORY_SIZE);
  }
}
```

Add public method:

```typescript
public getSessionSummary(): SessionSummary {
  if (this.sessionHistory.length === 0) {
    return { history: '', pagesVisited: 0 };
  }

  const history = this.sessionHistory
    .map(h => h.title || new URL(h.url).pathname)
    .join(' → ');

  return {
    history,
    pagesVisited: this.sessionHistory.length,
  };
}
```

Update processSnapshot to record history:

```typescript
public processSnapshot(...): SnapshotResult {
  // ... existing logic ...

  // Record navigation when URL changes
  if (!this.isSamePage(url)) {
    this.recordNavigation(url, title);
  }

  // ... rest of method ...
}
```

Update reset:

```typescript
public reset(): void {
  this.lastSnapshot = null;
  this.lastTimestamp = 0;
  this.sessionHistory = [];  // NEW
}
```

**Step 2: Run test to verify it passes**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/manager.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): implement session history tracking

Add session history to SnapshotManager:
- Tracks navigation between pages
- Limits to 10 most recent entries
- Provides getSessionSummary() for context
- Clears on reset()

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: Create Compactor Module

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/compactor.ts`

**Step 1: Create compactor.ts**

```typescript
/**
 * Context compaction utilities for snapshot optimization.
 */

import { createHash } from 'crypto';
import type { SnapshotElement, SessionHistoryEntry } from './types';

/**
 * Hash navigation pattern elements for deduplication.
 * If nav/footer is identical to previous page, can be skipped.
 */
export function hashNavigationPattern(elements: SnapshotElement[]): string {
  const navElements = elements.filter(e =>
    e.role === 'navigation' ||
    e.role === 'banner' ||
    e.role === 'contentinfo'
  );

  if (navElements.length === 0) return '';

  const signature = navElements
    .map(e => `${e.role}:${e.name ?? ''}`)
    .sort()
    .join('|');

  return createHash('md5').update(signature).digest('hex').slice(0, 8);
}

/**
 * Generate compact session history for context.
 */
export function summarizeSession(history: SessionHistoryEntry[]): string {
  if (history.length === 0) return '';
  if (history.length === 1) return `Currently on: ${history[0].title || 'Page'}`;

  const recent = history.slice(-5);
  return `Navigation: ${recent.map(h => h.title || 'Page').join(' → ')}`;
}

/**
 * Check if two navigation patterns are identical.
 */
export function isSameNavigation(hash1: string, hash2: string): boolean {
  return hash1 !== '' && hash1 === hash2;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/compactor.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): add context compaction module

Add compactor utilities:
- hashNavigationPattern: dedup nav/footer
- summarizeSession: compact history string
- isSameNavigation: pattern comparison

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 28: Write Compactor Tests

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/compactor.test.ts`

**Step 1: Create test file**

```typescript
import { describe, it, expect } from 'vitest';
import { hashNavigationPattern, summarizeSession, isSameNavigation } from './compactor';
import type { SnapshotElement, SessionHistoryEntry } from './types';

describe('compactor', () => {
  describe('hashNavigationPattern', () => {
    it('should hash navigation elements', () => {
      const elements: SnapshotElement[] = [
        { ref: 'e1', role: 'navigation', name: 'Main Nav' },
        { ref: 'e2', role: 'button', name: 'Click Me' },
        { ref: 'e3', role: 'banner', name: 'Header' },
      ];

      const hash = hashNavigationPattern(elements);
      expect(hash).toHaveLength(8);
    });

    it('should return empty string for no nav elements', () => {
      const elements: SnapshotElement[] = [
        { ref: 'e1', role: 'button', name: 'Click Me' },
      ];

      const hash = hashNavigationPattern(elements);
      expect(hash).toBe('');
    });

    it('should produce same hash for same nav pattern', () => {
      const elements1: SnapshotElement[] = [
        { ref: 'e1', role: 'navigation', name: 'Main Nav' },
      ];
      const elements2: SnapshotElement[] = [
        { ref: 'e99', role: 'navigation', name: 'Main Nav' },
      ];

      expect(hashNavigationPattern(elements1)).toBe(hashNavigationPattern(elements2));
    });
  });

  describe('summarizeSession', () => {
    it('should return empty for no history', () => {
      expect(summarizeSession([])).toBe('');
    });

    it('should format single page', () => {
      const history: SessionHistoryEntry[] = [
        { url: 'https://example.com', title: 'Home', timestamp: Date.now(), actionsTaken: [] },
      ];
      expect(summarizeSession(history)).toBe('Currently on: Home');
    });

    it('should format multiple pages with arrows', () => {
      const history: SessionHistoryEntry[] = [
        { url: 'https://example.com', title: 'Home', timestamp: Date.now(), actionsTaken: [] },
        { url: 'https://example.com/about', title: 'About', timestamp: Date.now(), actionsTaken: [] },
      ];
      expect(summarizeSession(history)).toBe('Navigation: Home → About');
    });

    it('should limit to 5 most recent', () => {
      const history: SessionHistoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/page${i}`,
        title: `Page ${i}`,
        timestamp: Date.now(),
        actionsTaken: [],
      }));

      const summary = summarizeSession(history);
      expect(summary).not.toContain('Page 0');
      expect(summary).toContain('Page 9');
    });
  });

  describe('isSameNavigation', () => {
    it('should return true for matching hashes', () => {
      expect(isSameNavigation('abc12345', 'abc12345')).toBe(true);
    });

    it('should return false for empty hashes', () => {
      expect(isSameNavigation('', '')).toBe(false);
    });

    it('should return false for different hashes', () => {
      expect(isSameNavigation('abc12345', 'xyz67890')).toBe(false);
    });
  });
});
```

**Step 2: Run tests**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test src/snapshot/compactor.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/compactor.test.ts
git commit -m "$(cat <<'EOF'
test(snapshot): add compactor module tests

Tests for:
- hashNavigationPattern
- summarizeSession
- isSameNavigation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 29: Export Compactor Module

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts`

**Step 1: Add export**

```typescript
export * from './compactor';
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts
git commit -m "$(cat <<'EOF'
feat(snapshot): export compactor module

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 30: Include Session Summary in Snapshot Output

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts`

**Step 1: Update browser_snapshot handler to include history**

In the handler, after getting the snapshot result, prepend session summary:

```typescript
case 'browser_snapshot': {
  // ... existing code ...

  const snapshotResult = snapshotManager.processSnapshot(...);

  // Build output with optional session history
  let output = '';

  if (input.include_history !== false) {
    const sessionSummary = snapshotManager.getSessionSummary();
    if (sessionSummary.history) {
      output += `# ${sessionSummary.history}\n`;
    }
  }

  output += snapshotResult.content;

  return { content: [{ type: 'text', text: output }] };
}
```

**Step 2: Update schema to include include_history**

```typescript
include_history: {
  type: 'boolean',
  description: 'Include navigation history in output. Default: true',
},
```

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "$(cat <<'EOF'
feat(mcp): include session history in snapshot output

- Add include_history parameter (default: true)
- Prepend navigation summary to snapshot
- Helps agent maintain context across pages

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 31: Final Integration Test

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts`

**Step 1: Add end-to-end optimization test**

```typescript
describe('full optimization pipeline', () => {
  it('should produce optimized output with all tiers', () => {
    const manager = new SnapshotManager();

    // Simulate navigation
    manager.processSnapshot(yaml1, 'https://example.com/home', 'Home', {});
    manager.processSnapshot(yaml2, 'https://example.com/search', 'Search', {});

    // Verify session tracking
    const summary = manager.getSessionSummary();
    expect(summary.pagesVisited).toBe(2);
    expect(summary.history).toContain('Home');
    expect(summary.history).toContain('Search');
  });
});
```

**Step 2: Run all tests**

Run: `cd apps/desktop/skills/dev-browser-mcp && pnpm test`

Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts
git commit -m "$(cat <<'EOF'
test(snapshot): add full optimization pipeline test

Integration test verifying all optimization tiers
work together correctly.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 32: Run Full Test Suite

**Step 1: Run all tests in both packages**

```bash
cd apps/desktop/skills/dev-browser-mcp && pnpm test
cd apps/desktop/skills/dev-browser && pnpm test
```

Expected: All tests pass

**Step 2: Build both packages**

```bash
pnpm build
```

Expected: Build succeeds without errors

**Step 3: Commit any fixes needed**

If tests or build fail, fix issues and commit.

---

### Task 33: Update Package Documentation

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/README.md` (if exists)

**Step 1: Document new parameters**

Add section documenting the new browser_snapshot parameters:

```markdown
## browser_snapshot Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| interactive_only | boolean | true | Only include interactive elements |
| full_snapshot | boolean | false | Bypass all limits (escape hatch) |
| max_elements | number | 300 | Maximum elements (1-1000) |
| max_tokens | number | 8000 | Token budget (1000-50000) |
| viewport_only | boolean | false | Filter to viewport-visible elements |
| include_history | boolean | true | Include navigation history |

### Token Optimization

The snapshot tool automatically optimizes output:

1. **Element Filtering** - Prioritizes interactive elements by role (buttons > textboxes > links)
2. **Token Budget** - Truncates when approaching token limit
3. **Context Management** - Tracks session navigation history

When truncated, output includes metadata header:
```yaml
# Elements: 300 of 5538 (truncated: element limit)
# Tokens: ~4500
# Navigation: Home → Search → Results
```
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/README.md
git commit -m "$(cat <<'EOF'
docs: document token optimization parameters

Add documentation for new browser_snapshot parameters
and explain optimization tiers.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This plan implements a 3-tier token optimization system:

1. **Phase 1 (Tasks 1-16)**: Aggressive filtering with priority scoring and maxElements
2. **Phase 2 (Tasks 17-23)**: Token budget system with estimation
3. **Phase 3 (Tasks 24-33)**: Context management with session history

Each task is a small, testable unit following TDD principles. The implementation preserves backward compatibility through sensible defaults and the `fullSnapshot` escape hatch.

---

## Post-Implementation Bug Fix (2025-01-25)

### Issue: `browser_script` Not Applying Token Optimization

**Problem:** After implementing all phases, the token optimization was only applied to `browser_snapshot` tool calls. The `browser_script` tool (which is the preferred/faster tool and auto-returns snapshots) was calling `getAISnapshot(page)` without passing any options, bypassing all token budget enforcement.

**Impact:** Tasks using `browser_script` (the majority of browser automation tasks) would still hit API quota limits because:
- 8 `browser_script` calls × ~50K tokens per unbounded snapshot = 400K+ tokens just from snapshots
- Plus conversation context, this easily exceeded Gemini's 1M token limit

**Root Cause:** Four `getAISnapshot` calls in the `browser_script` handler passed no options:
- Line 2746: Explicit snapshot action (refs-only)
- Line 2896: Explicit snapshot action (with result)
- Line 2948: Error handler snapshot capture
- Line 2974: Auto-captured final page state

**Fix:** Added `DEFAULT_SNAPSHOT_OPTIONS` constant and applied it to all four calls:

```typescript
// apps/desktop/skills/dev-browser-mcp/src/index.ts

const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = {
  interactiveOnly: true,
  maxElements: 300,
  maxTokens: 8000,
};

// All getAISnapshot calls in browser_script now use:
snapshotResult = await getAISnapshot(page, DEFAULT_SNAPSHOT_OPTIONS);
```

**Verification:**
- TypeScript compilation passes
- `browser_snapshot` continues to accept user-specified options
- `browser_script` now enforces default token budget on all auto-snapshots

### Issue: Inlined SNAPSHOT_SCRIPT Missing Truncation Logic

**Problem:** After fixing the options issue, snapshots were still unbounded. Investigation revealed that `dev-browser-mcp/src/index.ts` has an **inlined copy** of the snapshot script (`SNAPSHOT_SCRIPT` constant ~800 lines) that is injected into the browser via `page.evaluate()`. This inlined script was missing all truncation logic.

**Root Cause:** The codebase had TWO copies of the snapshot script:
1. `dev-browser/src/snapshot/browser-script.ts` - **Unused** (dead code)
2. `dev-browser-mcp/src/index.ts` - `SNAPSHOT_SCRIPT` constant - **Actually used in production**

The plan's implementation added truncation logic to the wrong file (`browser-script.ts`).

**Fix:** Added all truncation functions directly to the inlined `SNAPSHOT_SCRIPT`:
- `ROLE_PRIORITIES` constant
- `VIEWPORT_BONUS`, `DEFAULT_PRIORITY` constants
- `isInViewport()` function
- `getElementPriority()` function
- `collectScoredElements()` function
- `truncateWithBudget()` function
- Updated `renderAriaTree()` to call truncation
- Updated `visit()` to skip elements not in `includedRefs` set

**Cleanup:** Deleted the unused dead code files:
- `dev-browser/src/client.ts`
- `dev-browser/src/snapshot/browser-script.ts` (1115 lines)
- `dev-browser/src/snapshot/inject.ts`
- `dev-browser/src/snapshot/index.ts`
- `dev-browser/src/snapshot/__tests__/`

### Issue: Tier 3 (Session History) Not Working for browser_script

**Problem:** Session history tracking (navigation breadcrumb: `# Page A → Page B → Page C`) only worked for `browser_snapshot` tool because it called `SnapshotManager.processSnapshot()`. The `browser_script` tool bypassed this entirely.

**Fix:** Added `getSnapshotWithHistory()` helper function and updated all snapshot calls in `browser_script` to use it:

```typescript
/**
 * Get a snapshot with session history header.
 * Used by browser_script to include Tier 3 context management.
 */
async function getSnapshotWithHistory(page: Page, options: SnapshotOptions = {}): Promise<string> {
  const rawSnapshot = await getAISnapshot(page, options);
  const url = page.url();
  const title = await page.title();

  // Record navigation in session history
  const manager = getSnapshotManager();
  manager.processSnapshot(rawSnapshot, url, title, {
    fullSnapshot: false,
    interactiveOnly: options.interactiveOnly ?? true,
  });

  // Build output with session history
  let output = '';
  const sessionSummary = manager.getSessionSummary();
  if (sessionSummary.history) {
    output += `# ${sessionSummary.history}\n\n`;
  }
  output += rawSnapshot;

  return output;
}
```

Updated 4 locations in `browser_script`:
1. Line ~2886: Explicit snapshot action (refs-only)
2. Line ~3036: Explicit snapshot action (with result)
3. Line ~3088: Error handler snapshot capture
4. Line ~3114: Auto-captured final page state

### Production Verification Results

Tested with actual browser automation task (58+ browser calls):

**Snapshot Headers Showing Truncation:**
```yaml
# Elements: 300 of 410 (truncated: element limit)
# Tokens: ~4500
```

**Key Metrics:**
- Element count capped at 300 (vs 400-5500 unbounded)
- Token estimate ~4500 (vs 50K+ unbounded)
- 58+ browser script calls completed without hitting Gemini quota
- Session history tracking shows navigation breadcrumbs

**All 3 Tiers Verified Working:**
1. ✅ **Element Filtering**: Priority scoring + maxElements limit
2. ✅ **Token Budget**: ~4500 tokens per snapshot (well under 8K budget)
3. ✅ **Context Management**: Session history displayed in both `browser_snapshot` and `browser_script`
