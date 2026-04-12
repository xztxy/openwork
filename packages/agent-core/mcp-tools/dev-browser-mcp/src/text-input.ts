import type { Page } from 'playwright';

export async function cdpInsertText(page: Page, text: string): Promise<void> {
  // Use CDP Input.insertText for fast text insertion without simulating keystrokes
  // This bypasses IME and is much faster than page.keyboard.type() for long strings
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.insertText', { text });
  } finally {
    await client.detach().catch(() => {});
  }
}
