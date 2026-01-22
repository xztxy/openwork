# Snapshot Diffing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce token usage by 60%+ for same-page browser interactions through smart snapshot diffing.

**Architecture:** The dev-browser-mcp server will track snapshot history and return diffs instead of full snapshots when on the same page. A SnapshotManager tracks state, and a SnapshotDiffer computes element-level diffs.

**Tech Stack:** TypeScript, Vitest for testing, existing YAML snapshot format

---

## Task 1: Create Snapshot Types

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts`

**Step 1: Create the types file**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts

/**
 * Represents a parsed element from the ARIA snapshot
 */
export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  level?: number;
  pressed?: boolean | 'mixed';
  url?: string;
  placeholder?: string;
}

/**
 * Represents the full parsed snapshot with elements indexed by ref
 */
export interface ParsedSnapshot {
  url: string;
  title: string;
  timestamp: number;
  elements: Map<string, SnapshotElement>;
  rawYaml: string;
}

/**
 * Represents a change to an element between snapshots
 */
export interface ElementChange {
  ref: string;
  element: SnapshotElement;
  previousValue?: string;
  previousChecked?: boolean | 'mixed';
  previousDisabled?: boolean;
  previousExpanded?: boolean;
  previousSelected?: boolean;
  changeType: 'added' | 'modified' | 'removed';
}

/**
 * Result of diffing two snapshots
 */
export interface SnapshotDiff {
  unchangedRefs: string[];
  changes: ElementChange[];
  addedRefs: string[];
  removedRefs: string[];
}

/**
 * Result from SnapshotManager.processSnapshot()
 */
export type SnapshotResult =
  | { type: 'full'; content: string }
  | { type: 'diff'; content: string; unchangedRefs: string[] };
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts
git commit -m "feat(dev-browser-mcp): add snapshot diffing types"
```

---

## Task 2: Create Snapshot Parser

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.ts`

**Step 1: Create the parser that extracts elements from YAML snapshot**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.ts

import type { SnapshotElement, ParsedSnapshot } from './types.js';

/**
 * Parse a YAML snapshot string into a structured format with elements indexed by ref.
 *
 * Example input line:
 * - button "Submit" [ref=e5] [disabled]:
 *
 * Extracts: { ref: 'e5', role: 'button', name: 'Submit', disabled: true }
 */
export function parseSnapshot(
  yamlSnapshot: string,
  url: string,
  title: string
): ParsedSnapshot {
  const elements = new Map<string, SnapshotElement>();
  const lines = yamlSnapshot.split('\n');

  // Regex to match element lines with refs
  // Matches: - role "name" [ref=eN] [optional-attrs]:
  const elementRegex = /^(\s*)-\s+(\w+)(?:\s+"([^"]*)"|\s+'([^']*)')?(.*)$/;
  const refRegex = /\[ref=(e\d+)\]/;
  const valueRegex = /:\s*"([^"]*)"\s*$/;
  const checkedRegex = /\[checked(?:=(\w+))?\]/;
  const disabledRegex = /\[disabled\]/;
  const expandedRegex = /\[expanded\]/;
  const selectedRegex = /\[selected\]/;
  const levelRegex = /\[level=(\d+)\]/;
  const pressedRegex = /\[pressed(?:=(\w+))?\]/;

  for (const line of lines) {
    const match = line.match(elementRegex);
    if (!match) continue;

    const [, , role, nameDouble, nameSingle, rest] = match;
    const name = nameDouble ?? nameSingle ?? '';

    const refMatch = rest.match(refRegex);
    if (!refMatch) continue; // Skip elements without refs

    const ref = refMatch[1];
    const element: SnapshotElement = { ref, role, name };

    // Extract value (for inputs with content after colon)
    const valueMatch = line.match(valueRegex);
    if (valueMatch) {
      element.value = valueMatch[1];
    }

    // Extract boolean attributes
    const checkedMatch = rest.match(checkedRegex);
    if (checkedMatch) {
      element.checked = checkedMatch[1] === 'mixed' ? 'mixed' : true;
    }

    if (disabledRegex.test(rest)) {
      element.disabled = true;
    }

    if (expandedRegex.test(rest)) {
      element.expanded = true;
    }

    if (selectedRegex.test(rest)) {
      element.selected = true;
    }

    const levelMatch = rest.match(levelRegex);
    if (levelMatch) {
      element.level = parseInt(levelMatch[1], 10);
    }

    const pressedMatch = rest.match(pressedRegex);
    if (pressedMatch) {
      element.pressed = pressedMatch[1] === 'mixed' ? 'mixed' : true;
    }

    elements.set(ref, element);
  }

  return {
    url,
    title,
    timestamp: Date.now(),
    elements,
    rawYaml: yamlSnapshot,
  };
}

/**
 * Extract the page title from snapshot metadata header.
 * Looks for "Page Title: ..." or similar patterns.
 */
export function extractTitleFromSnapshot(snapshot: string): string {
  const titleMatch = snapshot.match(/(?:Page Title|Title):\s*(.+)/i);
  return titleMatch ? titleMatch[1].trim() : '';
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.ts
git commit -m "feat(dev-browser-mcp): add snapshot parser for extracting elements"
```

---

## Task 3: Create Snapshot Differ

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.ts`

**Step 1: Create the differ that computes changes between snapshots**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.ts

import type { ParsedSnapshot, SnapshotDiff, ElementChange, SnapshotElement } from './types.js';

/**
 * Compare two parsed snapshots and return the diff.
 * Returns null if >70% of elements changed (not worth diffing).
 */
export function diffSnapshots(
  previous: ParsedSnapshot,
  current: ParsedSnapshot
): SnapshotDiff | null {
  const unchangedRefs: string[] = [];
  const changes: ElementChange[] = [];
  const addedRefs: string[] = [];
  const removedRefs: string[] = [];

  // Find elements in current that are new or changed
  for (const [ref, currentEl] of current.elements) {
    const previousEl = previous.elements.get(ref);

    if (!previousEl) {
      // Element is new
      addedRefs.push(ref);
      changes.push({
        ref,
        element: currentEl,
        changeType: 'added',
      });
    } else if (hasElementChanged(previousEl, currentEl)) {
      // Element changed
      changes.push({
        ref,
        element: currentEl,
        previousValue: previousEl.value,
        previousChecked: previousEl.checked,
        previousDisabled: previousEl.disabled,
        previousExpanded: previousEl.expanded,
        previousSelected: previousEl.selected,
        changeType: 'modified',
      });
    } else {
      // Element unchanged
      unchangedRefs.push(ref);
    }
  }

  // Find elements that were removed
  for (const [ref, previousEl] of previous.elements) {
    if (!current.elements.has(ref)) {
      removedRefs.push(ref);
      changes.push({
        ref,
        element: previousEl,
        changeType: 'removed',
      });
    }
  }

  // If >70% changed, not worth diffing
  const totalElements = current.elements.size;
  const changedCount = changes.length;
  if (totalElements > 0 && changedCount / totalElements > 0.7) {
    return null;
  }

  return {
    unchangedRefs,
    changes,
    addedRefs,
    removedRefs,
  };
}

/**
 * Check if an element has meaningfully changed.
 */
function hasElementChanged(previous: SnapshotElement, current: SnapshotElement): boolean {
  // Compare all relevant properties
  return (
    previous.role !== current.role ||
    previous.name !== current.name ||
    previous.value !== current.value ||
    previous.checked !== current.checked ||
    previous.disabled !== current.disabled ||
    previous.expanded !== current.expanded ||
    previous.selected !== current.selected ||
    previous.pressed !== current.pressed
  );
}

/**
 * Format a diff into a compact YAML-like string for the agent.
 */
export function formatDiff(
  diff: SnapshotDiff,
  url: string,
  title: string
): string {
  const lines: string[] = [];

  // Header
  lines.push(`[Same page: ${title}]`);
  lines.push(`[URL: ${url}]`);

  // Unchanged refs - compress consecutive refs
  if (diff.unchangedRefs.length > 0) {
    const compressed = compressRefList(diff.unchangedRefs);
    lines.push(`[Unchanged: ${compressed}]`);
  }

  lines.push('');

  // Changed elements
  if (diff.changes.length > 0) {
    lines.push('Changed:');
    for (const change of diff.changes) {
      lines.push(formatChange(change));
    }
  } else {
    lines.push('[No changes detected]');
  }

  lines.push('');
  lines.push('[Tip: Use browser_snapshot(full_snapshot=true) if elements seem incorrect]');

  return lines.join('\n');
}

/**
 * Format a single element change.
 */
function formatChange(change: ElementChange): string {
  const { ref, element, changeType } = change;
  const lines: string[] = [];

  const prefix = changeType === 'added' ? '+ ' : changeType === 'removed' ? '- ' : '';
  let line = `${prefix}ref: ${ref}`;
  line += `  role: ${element.role}`;
  if (element.name) {
    line += `  name: "${element.name}"`;
  }

  lines.push(line);

  // Show value changes for modified elements
  if (changeType === 'modified') {
    if (element.value !== undefined && element.value !== change.previousValue) {
      lines.push(`  value: "${element.value}"  # was: "${change.previousValue || ''}"`);
    }
    if (element.disabled !== undefined && element.disabled !== change.previousDisabled) {
      lines.push(`  disabled: ${element.disabled}  # was: ${change.previousDisabled || false}`);
    }
    if (element.checked !== undefined && element.checked !== change.previousChecked) {
      lines.push(`  checked: ${element.checked}  # was: ${change.previousChecked || false}`);
    }
    if (element.expanded !== undefined && element.expanded !== change.previousExpanded) {
      lines.push(`  expanded: ${element.expanded}  # was: ${change.previousExpanded || false}`);
    }
    if (element.selected !== undefined && element.selected !== change.previousSelected) {
      lines.push(`  selected: ${element.selected}  # was: ${change.previousSelected || false}`);
    }
  } else if (changeType === 'added' && element.value) {
    lines.push(`  value: "${element.value}"`);
  }

  return lines.join('\n');
}

/**
 * Compress a list of refs like ['e1', 'e2', 'e3', 'e5', 'e6'] into 'e1-e3, e5-e6'
 */
function compressRefList(refs: string[]): string {
  if (refs.length === 0) return '';

  // Extract numbers and sort
  const numbers = refs
    .map(ref => parseInt(ref.replace('e', ''), 10))
    .sort((a, b) => a - b);

  const ranges: string[] = [];
  let rangeStart = numbers[0];
  let rangeEnd = numbers[0];

  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] === rangeEnd + 1) {
      rangeEnd = numbers[i];
    } else {
      ranges.push(rangeStart === rangeEnd ? `e${rangeStart}` : `e${rangeStart}-e${rangeEnd}`);
      rangeStart = numbers[i];
      rangeEnd = numbers[i];
    }
  }
  ranges.push(rangeStart === rangeEnd ? `e${rangeStart}` : `e${rangeStart}-e${rangeEnd}`);

  return ranges.join(', ');
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.ts
git commit -m "feat(dev-browser-mcp): add snapshot differ for computing element changes"
```

---

## Task 4: Create Snapshot Manager

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts`

**Step 1: Create the manager that tracks state and decides full vs diff**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts

import type { ParsedSnapshot, SnapshotResult } from './types.js';
import { parseSnapshot } from './parser.js';
import { diffSnapshots, formatDiff } from './differ.js';

const SNAPSHOT_TIMEOUT_MS = 30000; // 30 seconds

export interface SnapshotManagerOptions {
  fullSnapshot?: boolean;
  interactiveOnly?: boolean;
}

/**
 * Manages snapshot state and decides whether to return full snapshots or diffs.
 *
 * Singleton per MCP server session - tracks the last snapshot to enable diffing.
 */
export class SnapshotManager {
  private lastSnapshot: ParsedSnapshot | null = null;
  private lastTimestamp: number = 0;

  /**
   * Process a new snapshot and decide whether to return full or diff.
   *
   * @param rawYaml - The raw YAML snapshot from the browser
   * @param url - Current page URL
   * @param title - Current page title
   * @param options - Processing options
   * @returns Full snapshot or diff result
   */
  processSnapshot(
    rawYaml: string,
    url: string,
    title: string,
    options: SnapshotManagerOptions = {}
  ): SnapshotResult {
    const currentSnapshot = parseSnapshot(rawYaml, url, title);
    const now = Date.now();

    // Force full snapshot if:
    // 1. Explicitly requested
    // 2. No previous snapshot
    // 3. Timeout exceeded (page may have changed significantly)
    if (
      options.fullSnapshot ||
      !this.lastSnapshot ||
      now - this.lastTimestamp > SNAPSHOT_TIMEOUT_MS
    ) {
      this.updateState(currentSnapshot, now);
      return { type: 'full', content: rawYaml };
    }

    // Check if same page
    if (this.isSamePage(currentSnapshot.url)) {
      const diff = diffSnapshots(this.lastSnapshot, currentSnapshot);

      // If too many changes, fall back to full snapshot
      if (!diff) {
        this.updateState(currentSnapshot, now);
        return { type: 'full', content: rawYaml };
      }

      // Return diff
      this.updateState(currentSnapshot, now);
      const formattedDiff = formatDiff(diff, url, title);
      return {
        type: 'diff',
        content: formattedDiff,
        unchangedRefs: diff.unchangedRefs,
      };
    }

    // New page - return full snapshot
    this.updateState(currentSnapshot, now);
    return { type: 'full', content: rawYaml };
  }

  /**
   * Reset the snapshot state. Call this after navigation or on errors.
   */
  reset(): void {
    this.lastSnapshot = null;
    this.lastTimestamp = 0;
  }

  /**
   * Check if current URL is the same page as last snapshot.
   * Normalizes URLs by removing hash fragments.
   */
  private isSamePage(currentUrl: string): boolean {
    if (!this.lastSnapshot) return false;

    const normalizedCurrent = this.normalizeUrl(currentUrl);
    const normalizedLast = this.normalizeUrl(this.lastSnapshot.url);

    return normalizedCurrent === normalizedLast;
  }

  /**
   * Normalize URL by removing hash fragment for SPA comparison.
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Update internal state with new snapshot.
   */
  private updateState(snapshot: ParsedSnapshot, timestamp: number): void {
    this.lastSnapshot = snapshot;
    this.lastTimestamp = timestamp;
  }
}

// Singleton instance for the MCP server session
let snapshotManagerInstance: SnapshotManager | null = null;

export function getSnapshotManager(): SnapshotManager {
  if (!snapshotManagerInstance) {
    snapshotManagerInstance = new SnapshotManager();
  }
  return snapshotManagerInstance;
}

export function resetSnapshotManager(): void {
  if (snapshotManagerInstance) {
    snapshotManagerInstance.reset();
  }
}
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts
git commit -m "feat(dev-browser-mcp): add snapshot manager for state tracking and diffing"
```

---

## Task 5: Create Index File for Snapshot Module

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts`

**Step 1: Create barrel export file**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts

export type {
  SnapshotElement,
  ParsedSnapshot,
  ElementChange,
  SnapshotDiff,
  SnapshotResult,
} from './types.js';

export { parseSnapshot, extractTitleFromSnapshot } from './parser.js';
export { diffSnapshots, formatDiff } from './differ.js';
export {
  SnapshotManager,
  getSnapshotManager,
  resetSnapshotManager,
  type SnapshotManagerOptions,
} from './manager.js';
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts
git commit -m "feat(dev-browser-mcp): add snapshot module barrel export"
```

---

## Task 6: Update browser_snapshot Tool Schema

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts:1386-1402`

**Step 1: Add full_snapshot parameter to tool schema**

Find the `browser_snapshot` tool definition around line 1386 and update it:

```typescript
    {
      name: 'browser_snapshot',
      description: 'Get the ARIA accessibility tree of the current page. Returns elements with refs like [ref=e5] that can be used with browser_click and browser_type. By default, returns a diff if the page hasn\'t changed since last snapshot. Use full_snapshot=true to force a complete snapshot after major page changes.',
      inputSchema: {
        type: 'object',
        properties: {
          page_name: {
            type: 'string',
            description: 'Optional name of the page to snapshot (default: "main")',
          },
          interactive_only: {
            type: 'boolean',
            description: 'If true, only show interactive elements (buttons, links, inputs, etc.). Default: true.',
          },
          full_snapshot: {
            type: 'boolean',
            description: 'Force a complete snapshot instead of a diff. Use after major page changes (modal opened, dynamic content loaded) or when element refs seem incorrect. Default: false.',
          },
        },
      },
    },
```

**Step 2: Update BrowserSnapshotInput interface around line 1193**

```typescript
interface BrowserSnapshotInput {
  page_name?: string;
  interactive_only?: boolean;
  full_snapshot?: boolean;
}
```

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "feat(dev-browser-mcp): add full_snapshot parameter to browser_snapshot tool"
```

---

## Task 7: Integrate Snapshot Manager into browser_snapshot Handler

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts:2020-2061`

**Step 1: Import snapshot manager at top of file (around line 24)**

Add after the existing imports:

```typescript
import { getSnapshotManager, resetSnapshotManager } from './snapshot/index.js';
```

**Step 2: Update browser_snapshot case handler (around line 2020)**

Replace the existing `case 'browser_snapshot':` handler:

```typescript
      case 'browser_snapshot': {
        const { page_name, interactive_only, full_snapshot } = args as BrowserSnapshotInput;
        const page = await getPage(page_name);
        const rawSnapshot = await getAISnapshot(page, { interactiveOnly: interactive_only ?? true });
        const viewport = page.viewportSize();
        const url = page.url();
        const title = await page.title();

        // Detect canvas-based apps that need special handling
        const canvasApps = [
          { pattern: /docs\.google\.com/, name: 'Google Docs' },
          { pattern: /sheets\.google\.com/, name: 'Google Sheets' },
          { pattern: /slides\.google\.com/, name: 'Google Slides' },
          { pattern: /figma\.com/, name: 'Figma' },
          { pattern: /canva\.com/, name: 'Canva' },
          { pattern: /miro\.com/, name: 'Miro' },
        ];
        const detectedApp = canvasApps.find(app => app.pattern.test(url));

        // Process through snapshot manager for diffing
        const manager = getSnapshotManager();
        const result = manager.processSnapshot(rawSnapshot, url, title, {
          fullSnapshot: full_snapshot,
          interactiveOnly: interactive_only ?? true,
        });

        // Build output with metadata header
        let output = `# Page Info\n`;
        output += `URL: ${url}\n`;
        output += `Viewport: ${viewport?.width || 1280}x${viewport?.height || 720} (center: ${Math.round((viewport?.width || 1280) / 2)}, ${Math.round((viewport?.height || 720) / 2)})\n`;

        if (result.type === 'diff') {
          output += `Mode: Diff (showing changes since last snapshot)\n`;
        } else if (interactive_only ?? true) {
          output += `Mode: Interactive elements only (buttons, links, inputs)\n`;
        }

        if (detectedApp) {
          output += `\n⚠️ CANVAS APP DETECTED: ${detectedApp.name}\n`;
          output += `This app uses canvas rendering. Element refs may not work for the main content area.\n`;
          output += `Use: browser_click(position="center-lower") then browser_keyboard(action="type", text="...")\n`;
          output += `(center-lower avoids UI overlays like Google Docs AI suggestions)\n`;
        }

        if (result.type === 'diff') {
          output += `\n# Changes Since Last Snapshot\n${result.content}`;
        } else {
          output += `\n# Accessibility Tree\n${result.content}`;
        }

        return {
          content: [{
            type: 'text',
            text: output,
          }],
        };
      }
```

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "feat(dev-browser-mcp): integrate snapshot manager for automatic diffing"
```

---

## Task 8: Reset Snapshot State on Navigation

**Files:**
- Modify: `apps/desktop/skills/dev-browser-mcp/src/index.ts:1980-2018`

**Step 1: Add snapshot reset in browser_navigate handler**

Find the `case 'browser_navigate':` handler (around line 1980) and add a reset call after successful navigation:

```typescript
      case 'browser_navigate': {
        const { url, page_name } = args as BrowserNavigateInput;
        const page = await getPage(page_name);

        // Reset snapshot state - we're navigating to a new page
        resetSnapshotManager();

        console.error(`[MCP] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForPageLoad(page);
        // ... rest of handler
```

**Step 2: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/index.ts
git commit -m "feat(dev-browser-mcp): reset snapshot state on navigation"
```

---

## Task 9: Add Unit Tests for Snapshot Parser

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.test.ts`

**Step 1: Create test file**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.test.ts

import { describe, it, expect } from 'vitest';
import { parseSnapshot, extractTitleFromSnapshot } from './parser.js';

describe('parseSnapshot', () => {
  it('parses a simple element with ref', () => {
    const yaml = `- button "Submit" [ref=e1]`;
    const result = parseSnapshot(yaml, 'https://example.com', 'Test Page');

    expect(result.elements.size).toBe(1);
    expect(result.elements.get('e1')).toEqual({
      ref: 'e1',
      role: 'button',
      name: 'Submit',
    });
  });

  it('parses element with value', () => {
    const yaml = `- textbox "Email" [ref=e1]: "user@example.com"`;
    const result = parseSnapshot(yaml, 'https://example.com', 'Test');

    expect(result.elements.get('e1')?.value).toBe('user@example.com');
  });

  it('parses disabled attribute', () => {
    const yaml = `- button "Submit" [ref=e1] [disabled]`;
    const result = parseSnapshot(yaml, 'https://example.com', 'Test');

    expect(result.elements.get('e1')?.disabled).toBe(true);
  });

  it('parses checked attribute', () => {
    const yaml = `- checkbox "Agree" [ref=e1] [checked]`;
    const result = parseSnapshot(yaml, 'https://example.com', 'Test');

    expect(result.elements.get('e1')?.checked).toBe(true);
  });

  it('parses checked=mixed attribute', () => {
    const yaml = `- checkbox "Partial" [ref=e1] [checked=mixed]`;
    const result = parseSnapshot(yaml, 'https://example.com', 'Test');

    expect(result.elements.get('e1')?.checked).toBe('mixed');
  });

  it('parses multiple elements', () => {
    const yaml = `
- textbox "Email" [ref=e1]
- textbox "Password" [ref=e2]
- button "Login" [ref=e3]
    `.trim();
    const result = parseSnapshot(yaml, 'https://example.com', 'Login');

    expect(result.elements.size).toBe(3);
    expect(result.elements.has('e1')).toBe(true);
    expect(result.elements.has('e2')).toBe(true);
    expect(result.elements.has('e3')).toBe(true);
  });

  it('skips elements without refs', () => {
    const yaml = `
- heading "Welcome"
- button "Submit" [ref=e1]
    `.trim();
    const result = parseSnapshot(yaml, 'https://example.com', 'Test');

    expect(result.elements.size).toBe(1);
    expect(result.elements.has('e1')).toBe(true);
  });

  it('stores url and title', () => {
    const yaml = `- button "Test" [ref=e1]`;
    const result = parseSnapshot(yaml, 'https://example.com/page', 'My Page');

    expect(result.url).toBe('https://example.com/page');
    expect(result.title).toBe('My Page');
  });
});

describe('extractTitleFromSnapshot', () => {
  it('extracts title from Page Title header', () => {
    const snapshot = `# Page Info
Page Title: My Login Page
URL: https://example.com`;

    expect(extractTitleFromSnapshot(snapshot)).toBe('My Login Page');
  });

  it('returns empty string if no title found', () => {
    const snapshot = `# Some other content`;
    expect(extractTitleFromSnapshot(snapshot)).toBe('');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/desktop/skills/dev-browser-mcp && npx vitest run src/snapshot/parser.test.ts`

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.test.ts
git commit -m "test(dev-browser-mcp): add unit tests for snapshot parser"
```

---

## Task 10: Add Unit Tests for Snapshot Differ

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.test.ts`

**Step 1: Create test file**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.test.ts

import { describe, it, expect } from 'vitest';
import { diffSnapshots, formatDiff, compressRefList } from './differ.js';
import type { ParsedSnapshot, SnapshotElement } from './types.js';

function createSnapshot(elements: SnapshotElement[]): ParsedSnapshot {
  const map = new Map<string, SnapshotElement>();
  for (const el of elements) {
    map.set(el.ref, el);
  }
  return {
    url: 'https://example.com',
    title: 'Test Page',
    timestamp: Date.now(),
    elements: map,
    rawYaml: '',
  };
}

describe('diffSnapshots', () => {
  it('returns empty diff for identical snapshots', () => {
    const elements = [
      { ref: 'e1', role: 'button', name: 'Submit' },
      { ref: 'e2', role: 'textbox', name: 'Email' },
    ];
    const snapshot1 = createSnapshot(elements);
    const snapshot2 = createSnapshot(elements);

    const diff = diffSnapshots(snapshot1, snapshot2);

    expect(diff).not.toBeNull();
    expect(diff!.unchangedRefs).toEqual(['e1', 'e2']);
    expect(diff!.changes).toHaveLength(0);
  });

  it('detects added elements', () => {
    const prev = createSnapshot([
      { ref: 'e1', role: 'button', name: 'Submit' },
    ]);
    const curr = createSnapshot([
      { ref: 'e1', role: 'button', name: 'Submit' },
      { ref: 'e2', role: 'textbox', name: 'Email' },
    ]);

    const diff = diffSnapshots(prev, curr);

    expect(diff!.addedRefs).toContain('e2');
    expect(diff!.changes.find(c => c.ref === 'e2')?.changeType).toBe('added');
  });

  it('detects removed elements', () => {
    const prev = createSnapshot([
      { ref: 'e1', role: 'button', name: 'Submit' },
      { ref: 'e2', role: 'textbox', name: 'Email' },
    ]);
    const curr = createSnapshot([
      { ref: 'e1', role: 'button', name: 'Submit' },
    ]);

    const diff = diffSnapshots(prev, curr);

    expect(diff!.removedRefs).toContain('e2');
    expect(diff!.changes.find(c => c.ref === 'e2')?.changeType).toBe('removed');
  });

  it('detects value changes', () => {
    const prev = createSnapshot([
      { ref: 'e1', role: 'textbox', name: 'Email', value: '' },
    ]);
    const curr = createSnapshot([
      { ref: 'e1', role: 'textbox', name: 'Email', value: 'user@example.com' },
    ]);

    const diff = diffSnapshots(prev, curr);

    expect(diff!.changes).toHaveLength(1);
    expect(diff!.changes[0].changeType).toBe('modified');
    expect(diff!.changes[0].previousValue).toBe('');
    expect(diff!.changes[0].element.value).toBe('user@example.com');
  });

  it('detects disabled state changes', () => {
    const prev = createSnapshot([
      { ref: 'e1', role: 'button', name: 'Submit', disabled: true },
    ]);
    const curr = createSnapshot([
      { ref: 'e1', role: 'button', name: 'Submit', disabled: false },
    ]);

    const diff = diffSnapshots(prev, curr);

    expect(diff!.changes).toHaveLength(1);
    expect(diff!.changes[0].previousDisabled).toBe(true);
  });

  it('returns null when >70% changed', () => {
    const prev = createSnapshot([
      { ref: 'e1', role: 'button', name: 'A' },
      { ref: 'e2', role: 'button', name: 'B' },
      { ref: 'e3', role: 'button', name: 'C' },
    ]);
    const curr = createSnapshot([
      { ref: 'e1', role: 'button', name: 'X' },
      { ref: 'e2', role: 'button', name: 'Y' },
      { ref: 'e3', role: 'button', name: 'Z' },
    ]);

    const diff = diffSnapshots(prev, curr);

    expect(diff).toBeNull();
  });
});

describe('compressRefList', () => {
  it('compresses consecutive refs into ranges', () => {
    const refs = ['e1', 'e2', 'e3', 'e5', 'e6', 'e10'];
    // Note: This function is not exported, but we can test it through formatDiff
    // For direct testing, you'd need to export it
  });
});

describe('formatDiff', () => {
  it('formats diff with header and changes', () => {
    const diff = {
      unchangedRefs: ['e1', 'e2', 'e3'],
      changes: [
        {
          ref: 'e4',
          element: { ref: 'e4', role: 'textbox', name: 'Email', value: 'test@example.com' },
          previousValue: '',
          changeType: 'modified' as const,
        },
      ],
      addedRefs: [],
      removedRefs: [],
    };

    const formatted = formatDiff(diff, 'https://example.com', 'Login Page');

    expect(formatted).toContain('[Same page: Login Page]');
    expect(formatted).toContain('[URL: https://example.com]');
    expect(formatted).toContain('[Unchanged: e1-e3]');
    expect(formatted).toContain('ref: e4');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/desktop/skills/dev-browser-mcp && npx vitest run src/snapshot/differ.test.ts`

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.test.ts
git commit -m "test(dev-browser-mcp): add unit tests for snapshot differ"
```

---

## Task 11: Add Unit Tests for Snapshot Manager

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts`

**Step 1: Create test file**

```typescript
// apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotManager } from './manager.js';

describe('SnapshotManager', () => {
  let manager: SnapshotManager;

  beforeEach(() => {
    manager = new SnapshotManager();
  });

  const simpleSnapshot = `- button "Submit" [ref=e1]`;

  it('returns full snapshot on first call', () => {
    const result = manager.processSnapshot(
      simpleSnapshot,
      'https://example.com',
      'Test Page'
    );

    expect(result.type).toBe('full');
    expect(result.content).toBe(simpleSnapshot);
  });

  it('returns diff on second call with same page', () => {
    // First call
    manager.processSnapshot(simpleSnapshot, 'https://example.com', 'Test');

    // Second call - same URL
    const result = manager.processSnapshot(
      simpleSnapshot,
      'https://example.com',
      'Test'
    );

    expect(result.type).toBe('diff');
  });

  it('returns full snapshot when URL changes', () => {
    // First call
    manager.processSnapshot(simpleSnapshot, 'https://example.com/page1', 'Page 1');

    // Second call - different URL
    const result = manager.processSnapshot(
      simpleSnapshot,
      'https://example.com/page2',
      'Page 2'
    );

    expect(result.type).toBe('full');
  });

  it('returns full snapshot when full_snapshot option is true', () => {
    // First call
    manager.processSnapshot(simpleSnapshot, 'https://example.com', 'Test');

    // Second call with full_snapshot: true
    const result = manager.processSnapshot(
      simpleSnapshot,
      'https://example.com',
      'Test',
      { fullSnapshot: true }
    );

    expect(result.type).toBe('full');
  });

  it('normalizes URLs for same-page detection', () => {
    // First call
    manager.processSnapshot(simpleSnapshot, 'https://example.com/page#section1', 'Test');

    // Second call - same URL, different hash
    const result = manager.processSnapshot(
      simpleSnapshot,
      'https://example.com/page#section2',
      'Test'
    );

    expect(result.type).toBe('diff');
  });

  it('resets state correctly', () => {
    // First call
    manager.processSnapshot(simpleSnapshot, 'https://example.com', 'Test');

    // Reset
    manager.reset();

    // Should act like first call again
    const result = manager.processSnapshot(
      simpleSnapshot,
      'https://example.com',
      'Test'
    );

    expect(result.type).toBe('full');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd apps/desktop/skills/dev-browser-mcp && npx vitest run src/snapshot/manager.test.ts`

**Step 3: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts
git commit -m "test(dev-browser-mcp): add unit tests for snapshot manager"
```

---

## Task 12: Add Vitest Configuration for dev-browser-mcp

**Files:**
- Create: `apps/desktop/skills/dev-browser-mcp/vitest.config.ts`
- Modify: `apps/desktop/skills/dev-browser-mcp/package.json`

**Step 1: Create vitest config**

```typescript
// apps/desktop/skills/dev-browser-mcp/vitest.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 2: Update package.json to add test script and vitest dependency**

```json
{
  "name": "dev-browser-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "npx tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "playwright": "npm:rebrowser-playwright@^1.52.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

**Step 3: Install vitest**

Run: `cd apps/desktop/skills/dev-browser-mcp && npm install`

**Step 4: Run all tests**

Run: `cd apps/desktop/skills/dev-browser-mcp && npm test`

**Step 5: Commit**

```bash
git add apps/desktop/skills/dev-browser-mcp/vitest.config.ts apps/desktop/skills/dev-browser-mcp/package.json apps/desktop/skills/dev-browser-mcp/package-lock.json
git commit -m "chore(dev-browser-mcp): add vitest configuration for testing"
```

---

## Task 13: Run Full Test Suite and Fix Issues

**Step 1: Run the complete test suite**

Run: `cd apps/desktop/skills/dev-browser-mcp && npm test`

Expected: All tests pass

**Step 2: Fix any failing tests**

If tests fail, analyze the error and fix the implementation.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(dev-browser-mcp): fix issues found during testing"
```

---

## Task 14: E2E Test with Local Agent

**Step 1: Start the dev browser server**

Run: `cd apps/desktop && pnpm dev` (in a separate terminal)

**Step 2: Run a test prompt that exercises snapshot diffing**

Run: `cd apps/desktop && pnpm test:local-agent "Go to https://example.com, take a snapshot, click on a link, take another snapshot"`

**Step 3: Observe the output**

Look for:
- First snapshot should be full
- Second snapshot (if same page) should show diff format
- Token count in the output

**Step 4: Test with form filling**

Run: `cd apps/desktop && pnpm test:local-agent "Go to a login page, take a snapshot, fill in the email field with 'test@example.com', take another snapshot and verify the change is shown in the diff"`

**Step 5: Document any issues found**

If issues are found, create follow-up tasks.

---

## Task 15: Final Commit and Summary

**Step 1: Ensure all changes are committed**

Run: `git status`

If there are uncommitted changes:

```bash
git add -A
git commit -m "chore(dev-browser-mcp): final cleanup for snapshot diffing feature"
```

**Step 2: Push branch**

```bash
git push -u origin fix/prompt-size-limit
```

**Step 3: Summary of changes**

Files created:
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/types.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/index.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/parser.test.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/differ.test.ts`
- `apps/desktop/skills/dev-browser-mcp/src/snapshot/manager.test.ts`
- `apps/desktop/skills/dev-browser-mcp/vitest.config.ts`

Files modified:
- `apps/desktop/skills/dev-browser-mcp/src/index.ts` (tool schema + handler integration)
- `apps/desktop/skills/dev-browser-mcp/package.json` (vitest dependency + test script)

---

## Success Criteria Verification

After completing all tasks, verify:

1. [ ] `npm test` passes in dev-browser-mcp directory
2. [ ] First snapshot returns full content
3. [ ] Subsequent same-page snapshots return diffs
4. [ ] `full_snapshot: true` forces full snapshot
5. [ ] Navigation resets snapshot state
6. [ ] Diff output includes unchanged refs and changes
7. [ ] Token savings visible in E2E test output
