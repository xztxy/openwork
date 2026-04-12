import type { Page } from 'playwright';

export interface ClickChangeResult {
  changed: boolean;
  addedNodes: number;
  removedNodes: number;
  urlChanged: boolean;
  newUrl?: string;
}

export async function detectChangesAfterClick(
  page: Page,
  clickFn: () => Promise<void>,
  timeoutMs = 2000,
): Promise<ClickChangeResult> {
  const urlBefore = page.url();

  const observerScript = () => {
    const result = { addedNodes: 0, removedNodes: 0 };
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        result.addedNodes += m.addedNodes.length;
        result.removedNodes += m.removedNodes.length;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    (window as Window & Record<string, unknown>).__clickObserver = { observer, result };
  };

  await page.evaluate(observerScript);
  await clickFn();
  await page.waitForTimeout(Math.min(timeoutMs, 500));

  const mutationResult = await page
    .evaluate(() => {
      const state = (window as Window & Record<string, unknown>).__clickObserver as
        | { observer: MutationObserver; result: { addedNodes: number; removedNodes: number } }
        | undefined;
      if (state) state.observer.disconnect();
      return state?.result ?? { addedNodes: 0, removedNodes: 0 };
    })
    .catch(() => ({ addedNodes: 0, removedNodes: 0 }));

  const urlAfter = page.url();
  const urlChanged = urlAfter !== urlBefore;

  return {
    changed: mutationResult.addedNodes > 0 || mutationResult.removedNodes > 0 || urlChanged,
    addedNodes: mutationResult.addedNodes,
    removedNodes: mutationResult.removedNodes,
    urlChanged,
    newUrl: urlChanged ? urlAfter : undefined,
  };
}
