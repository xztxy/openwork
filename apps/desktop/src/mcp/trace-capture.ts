import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from 'playwright-core';

const TRACE_CAPTURE_DIR = join(tmpdir(), 'accomplish-trace-capture');
const TRACE_DEBUG_LOG = join(tmpdir(), 'dev-browser-mcp-trace-debug.log');

let cachedBrowserUA: string | null = null;

try {
  mkdirSync(TRACE_CAPTURE_DIR, { recursive: true });
} catch (_e) {
  // ignore
}
try {
  writeFileSync(TRACE_DEBUG_LOG, `[${new Date().toISOString()}] trace-capture module loaded\n`);
} catch (_e) {
  // ignore
}

const TRACE_CAPTURE_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_keyboard',
  'browser_wait',
  'browser_select',
  'browser_drag',
  'browser_file_upload',
  'browser_hover',
  'browser_script',
  'browser_sequence',
  'browser_batch_actions',
  'browser_tabs',
  'browser_tab_new',
  'browser_tab_select',
  'browser_tab_close',
  'browser_canvas_type',
  'browser_canvas_click',
  'browser_iframe',
  'browser_handle_dialog',
  'browser_press_key',
  'browser_screenshot',
  'browser_snapshot',
  'browser_evaluate',
]);

const DOM_SNAPSHOT_COMPUTED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'overflow',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-size',
  'font-weight',
  'font-family',
  'color',
  'background-color',
  'z-index',
  'transform',
  'cursor',
  'pointer-events',
  'flex-direction',
  'justify-content',
  'align-items',
  'grid-template-columns',
  'grid-template-rows',
];

interface SnapshotOptions {
  interactiveOnly: boolean;
  maxElements: number;
  maxTokens: number;
  rawTree: boolean;
  viewportOnly: boolean;
  includeBoundingBoxes: boolean;
  includeAllTextNodes: boolean;
  preserveSubtrees: boolean;
}

interface ContentItem {
  type: 'text';
  text: string;
}

interface ToolResult {
  content?: ContentItem[];
  isError?: boolean;
}

interface TraceContext {
  getPage: (pageName?: string) => Promise<Page>;
  getAISnapshot: (page: Page, options: SnapshotOptions) => Promise<string>;
}

let lastSeenTurnSignal: string | null = null;
let initialCaptureFailCount = 0;

function getInitialCaptureMarkerPath(): string {
  const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
  return join(TRACE_CAPTURE_DIR, `initial-captured-${taskId}.marker`);
}

function hasInitialCaptureForTurn(turnSignal: string): boolean {
  try {
    const markerPath = getInitialCaptureMarkerPath();
    if (existsSync(markerPath)) {
      return readFileSync(markerPath, 'utf-8').trim() === turnSignal;
    }
  } catch (_e) {
    // ignore
  }
  return false;
}

function markInitialCaptured(turnSignal: string): void {
  try {
    writeFileSync(getInitialCaptureMarkerPath(), turnSignal, 'utf-8');
  } catch (_e) {
    // ignore
  }
}

function readTurnSignal(): string | null {
  try {
    const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';
    const signalPath = join(TRACE_CAPTURE_DIR, `turn-signal-${taskId}.txt`);
    if (existsSync(signalPath)) {
      return readFileSync(signalPath, 'utf-8').trim();
    }
  } catch (_e) {
    // ignore
  }
  return null;
}

async function captureTraceState(
  page: Page,
  getAISnapshotFn: (page: Page, options: SnapshotOptions) => Promise<string>,
  markerPrefix = '',
): Promise<ContentItem[]> {
  const content: ContentItem[] = [];
  const timestamp = Date.now();
  const taskId = process.env.ACCOMPLISH_TASK_ID || 'default';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cdpSession: any = null;
  let froze = false;
  let injectedNoscriptHider = false;

  try {
    cdpSession = await page.context().newCDPSession(page);

    try {
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.id = '__trace-noscript-hider';
        style.textContent = 'noscript { display: none !important; visibility: hidden !important; }';
        document.head.appendChild(style);
      });
      injectedNoscriptHider = true;
    } catch (err) {
      console.error('[dev-browser-mcp] Trace: failed to inject noscript hider:', err);
    }

    await cdpSession.send('Emulation.setScriptExecutionDisabled', { value: true });
    froze = true;

    // Screenshot
    try {
      appendFileSync(
        TRACE_DEBUG_LOG,
        `[${new Date().toISOString()}] captureTraceState: capturing screenshot (frozen)...\n`,
      );
      const screenshotBuffer = await page.screenshot({ fullPage: false, type: 'png' });
      const screenshotPath = join(TRACE_CAPTURE_DIR, `screenshot-${taskId}-${timestamp}.png`);
      writeFileSync(screenshotPath, screenshotBuffer);
      appendFileSync(
        TRACE_DEBUG_LOG,
        `[${new Date().toISOString()}] captureTraceState: screenshot saved to ${screenshotPath}\n`,
      );
      content.push({
        type: 'text',
        text: `\n---${markerPrefix}TRACE_SCREENSHOT_FILE---\n${screenshotPath}\n---END_${markerPrefix}TRACE_SCREENSHOT_FILE---`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendFileSync(
        TRACE_DEBUG_LOG,
        `[${new Date().toISOString()}] captureTraceState: screenshot FAILED: ${errMsg}\n`,
      );
      console.error('[dev-browser-mcp] Trace: failed to capture screenshot:', err);
    }

    // AX Tree
    try {
      const axTreeResult = await cdpSession.send('Accessibility.getFullAXTree');
      const axTreeJson = JSON.stringify(axTreeResult);
      const axTreePath = join(TRACE_CAPTURE_DIR, `axtree-${taskId}-${timestamp}.json`);
      writeFileSync(axTreePath, axTreeJson);
      content.push({
        type: 'text',
        text: `\n---${markerPrefix}TRACE_AXTREE_FILE---\n${axTreePath}\n---END_${markerPrefix}TRACE_AXTREE_FILE---`,
      });
    } catch (err) {
      console.error('[dev-browser-mcp] Trace: failed to capture AXTree:', err);
    }

    // DOM Snapshot
    try {
      const domSnapshotResult = await cdpSession.send('DOMSnapshot.captureSnapshot', {
        computedStyles: DOM_SNAPSHOT_COMPUTED_STYLES,
        includeDOMRects: true,
        includePaintOrder: true,
        includeBlendedBackgroundColors: true,
        includeTextColorOpacities: true,
      });
      const domSnapshotJson = JSON.stringify(domSnapshotResult);
      const domSnapshotPath = join(TRACE_CAPTURE_DIR, `domsnapshot-${taskId}-${timestamp}.json`);
      writeFileSync(domSnapshotPath, domSnapshotJson);
      content.push({
        type: 'text',
        text: `\n---${markerPrefix}TRACE_DOMSNAPSHOT_FILE---\n${domSnapshotPath}\n---END_${markerPrefix}TRACE_DOMSNAPSHOT_FILE---`,
      });
    } catch (err) {
      console.error('[dev-browser-mcp] Trace: failed to capture DOM Snapshot:', err);
    }

    // Raw HTML
    try {
      const docResult = await cdpSession.send('DOM.getDocument', { depth: 0 });
      const htmlResult = await cdpSession.send('DOM.getOuterHTML', {
        nodeId: docResult.root.nodeId,
      });
      const rawHtml = htmlResult.outerHTML as string;
      const rawHtmlPath = join(TRACE_CAPTURE_DIR, `rawhtml-${taskId}-${timestamp}.html`);
      writeFileSync(rawHtmlPath, rawHtml, 'utf-8');
      content.push({
        type: 'text',
        text: `\n---${markerPrefix}TRACE_RAWHTML_FILE---\n${rawHtmlPath}\n---END_${markerPrefix}TRACE_RAWHTML_FILE---`,
      });
    } catch (err) {
      console.error('[dev-browser-mcp] Trace: failed to capture Raw HTML:', err);
    }
  } catch (err) {
    console.error('[dev-browser-mcp] Trace: CDP session failed:', err);
  } finally {
    if (cdpSession) {
      if (froze) {
        try {
          await cdpSession.send('Emulation.setScriptExecutionDisabled', {
            value: false,
          });
        } catch (_e) {
          // ignore
        }
      }
      try {
        await cdpSession.detach();
      } catch (_e) {
        // ignore
      }
    }
    if (injectedNoscriptHider) {
      try {
        await page.evaluate(() => {
          document.getElementById('__trace-noscript-hider')?.remove();
        });
      } catch (_e) {
        // ignore
      }
    }
  }

  // Aria snapshot (captured after unfreezing JS so getAISnapshot can evaluate)
  const captureAria = async (retryCount = 0): Promise<void> => {
    try {
      const delay = retryCount === 0 ? 100 : 500 * retryCount;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const ariaContent = await getAISnapshotFn(page, {
        interactiveOnly: false,
        maxElements: Infinity,
        maxTokens: Infinity,
        rawTree: true,
        viewportOnly: false,
        includeBoundingBoxes: true,
        includeAllTextNodes: true,
        preserveSubtrees: true,
      });

      if (ariaContent) {
        const url = page.url();
        const title = await page.title();
        let viewport = page.viewportSize();
        if (!viewport || (viewport.width === 0 && viewport.height === 0)) {
          const windowSize = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          }));
          viewport = windowSize;
        }
        if (cachedBrowserUA === null) {
          try {
            cachedBrowserUA = await page.evaluate(() => navigator.userAgent);
          } catch (_e) {
            cachedBrowserUA = '';
          }
        }

        const ariaPath = join(TRACE_CAPTURE_DIR, `aria-${taskId}-${timestamp}.yaml`);
        const ariaFullContent = `URL: ${url}\nTitle: ${title}\nViewport: ${viewport?.width || 0}x${viewport?.height || 0}\nBounding Box Format: [x, y, width, height]\nUser-Agent: ${cachedBrowserUA || ''}\n\n${ariaContent}`;
        writeFileSync(ariaPath, ariaFullContent);

        content.push({
          type: 'text',
          text: `\n---${markerPrefix}TRACE_ARIA_FILE---\n${ariaPath}\n---END_${markerPrefix}TRACE_ARIA_FILE---`,
        });
      } else if (retryCount < 2) {
        return captureAria(retryCount + 1);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (retryCount < 2 && errMsg.includes('context was destroyed')) {
        return captureAria(retryCount + 1);
      }
      console.error('[dev-browser-mcp] Trace: failed to capture ARIA snapshot:', err);
    }
  };

  await captureAria();
  return content;
}

export async function handlePreAction(
  name: string,
  args: { page_name?: string },
  ctx: TraceContext,
): Promise<ContentItem[] | null> {
  if (!TRACE_CAPTURE_TOOLS.has(name)) {
    return null;
  }

  const isNewProcess = lastSeenTurnSignal === null;
  const currentTurnSignal = readTurnSignal();

  if (currentTurnSignal && currentTurnSignal !== lastSeenTurnSignal) {
    lastSeenTurnSignal = currentTurnSignal;
    initialCaptureFailCount = 0;
  }

  const alreadyCaptured = isNewProcess
    ? false
    : currentTurnSignal
      ? hasInitialCaptureForTurn(currentTurnSignal)
      : false;

  if (!alreadyCaptured && initialCaptureFailCount < 3) {
    try {
      const page = await ctx.getPage(args.page_name);
      const result = await captureTraceState(page, ctx.getAISnapshot, 'INITIAL_');
      if (currentTurnSignal) {
        markInitialCaptured(currentTurnSignal);
      }
      initialCaptureFailCount = 0;
      appendFileSync(
        TRACE_DEBUG_LOG,
        `[${new Date().toISOString()}] Initial state captured for tool: ${name} (newProcess=${isNewProcess}, turnSignal=${currentTurnSignal})\n`,
      );
      return result;
    } catch (err) {
      initialCaptureFailCount++;
      appendFileSync(
        TRACE_DEBUG_LOG,
        `[${new Date().toISOString()}] Initial capture failed (attempt ${initialCaptureFailCount}): ${err}\n`,
      );
    }
  }

  return null;
}

export async function handlePostAction(
  name: string,
  args: { page_name?: string },
  toolResult: ToolResult,
  initialCaptureContent: ContentItem[] | null,
  ctx: TraceContext,
): Promise<ToolResult> {
  if (!TRACE_CAPTURE_TOOLS.has(name)) {
    return toolResult;
  }

  let traceContent: ContentItem[] = [];

  if (!toolResult.isError) {
    try {
      const tracePage = await ctx.getPage(args.page_name);
      try {
        await tracePage.waitForLoadState('networkidle', { timeout: 2000 });
      } catch (_e) {
        // ignore timeout
      }
      traceContent = await captureTraceState(tracePage, ctx.getAISnapshot);
    } catch (err) {
      appendFileSync(
        TRACE_DEBUG_LOG,
        `[${new Date().toISOString()}] Post-action trace capture failed for ${name}: ${err}\n`,
      );
    }
  }

  const hasTraceContent = traceContent && traceContent.length > 0;
  const hasInitialContent = initialCaptureContent && initialCaptureContent.length > 0;

  if (hasTraceContent || hasInitialContent) {
    const baseContent = toolResult.content || [];
    const postContent = hasTraceContent ? traceContent : [];
    const preContent = hasInitialContent ? initialCaptureContent : [];
    toolResult.content = [...preContent, ...baseContent, ...postContent];
  }

  return toolResult;
}

export { TRACE_CAPTURE_TOOLS, DOM_SNAPSHOT_COMPUTED_STYLES };
