import type { Page } from 'playwright';

export const MAX_SCREENSHOT_BYTES = (() => {
  const parsed = Number.parseInt(process.env.DEV_BROWSER_MCP_MAX_SCREENSHOT_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
})();

export interface BoundedScreenshot {
  buffer: Buffer | null;
  fullPageUsed: boolean;
  qualityUsed: number;
  byteLength: number;
}

export async function captureBoundedScreenshot(
  page: Page,
  fullPageRequested: boolean,
): Promise<BoundedScreenshot> {
  const attempts = fullPageRequested
    ? [
        { fullPage: true, quality: 70 },
        { fullPage: true, quality: 55 },
        { fullPage: false, quality: 50 },
        { fullPage: false, quality: 40 },
      ]
    : [
        { fullPage: false, quality: 70 },
        { fullPage: false, quality: 55 },
        { fullPage: false, quality: 40 },
      ];

  for (const attempt of attempts) {
    const buffer = await page.screenshot({
      fullPage: attempt.fullPage,
      type: 'jpeg',
      quality: attempt.quality,
      scale: 'css',
    });

    if (buffer.byteLength <= MAX_SCREENSHOT_BYTES) {
      return {
        buffer,
        fullPageUsed: attempt.fullPage,
        qualityUsed: attempt.quality,
        byteLength: buffer.byteLength,
      };
    }
  }

  return {
    buffer: null,
    fullPageUsed: false,
    qualityUsed: 40,
    byteLength: 0,
  };
}
