import type { Page } from 'playwright';

export async function getViewportOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
}

export async function scaleCoordinateToViewport(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const viewport = page.viewportSize();
  if (!viewport) return { x, y };
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  return { x: x / devicePixelRatio, y: y / devicePixelRatio };
}

export async function clickAtCoordinates(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

export async function moveToCoordinates(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
}

export async function typeTextViaKeyboard(page: Page, text: string, delay = 20): Promise<void> {
  await page.keyboard.type(text, { delay });
}

export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}
