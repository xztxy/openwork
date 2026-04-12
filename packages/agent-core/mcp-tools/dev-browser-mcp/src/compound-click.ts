import type { Page, ElementHandle } from 'playwright';

export interface CompoundClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export async function handleCompoundClick(
  page: Page,
  element: ElementHandle,
  options: CompoundClickOptions = {},
): Promise<void> {
  await element.scrollIntoViewIfNeeded();
  await element.click({
    button: options.button ?? 'left',
    clickCount: options.clickCount ?? 1,
    delay: options.delay,
  });
}

export async function tryAutoReopen(
  page: Page,
  triggerRef: string | undefined,
  element: ElementHandle,
): Promise<void> {
  // If a trigger ref is specified, clicking the trigger may close a popup — reopen it
  if (!triggerRef) return;
  const isClosed = await page.evaluate(() => {
    const popup = document.querySelector('[role="listbox"], [role="menu"], [role="dialog"]');
    return !popup || (popup as HTMLElement).offsetParent === null;
  });
  if (isClosed) {
    await element.click().catch(() => {});
  }
}
