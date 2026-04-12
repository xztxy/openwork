import type { Page } from 'playwright';

export async function injectActiveTabGlow(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  try {
    await page.evaluate(() => {
      document.getElementById('__dev-browser-active-glow')?.remove();
      document.getElementById('__dev-browser-active-glow-style')?.remove();

      const style = document.createElement('style');
      style.id = '__dev-browser-active-glow-style';
      style.textContent = `
        @keyframes devBrowserGlowColor {
          0%, 100% { border-color: rgba(59, 130, 246, 0.9); box-shadow: inset 0 0 30px rgba(59, 130, 246, 0.6), 0 0 20px rgba(59, 130, 246, 0.4); }
          50% { border-color: rgba(236, 72, 153, 0.9); box-shadow: inset 0 0 30px rgba(236, 72, 153, 0.6), 0 0 20px rgba(236, 72, 153, 0.4); }
        }
      `;
      document.head.appendChild(style);

      const overlay = document.createElement('div');
      overlay.id = '__dev-browser-active-glow';
      overlay.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
        border: 5px solid rgba(59, 130, 246, 0.9); border-radius: 4px;
        animation: devBrowserGlowColor 6s ease-in-out infinite;
      `;
      document.body.appendChild(overlay);
    });
  } catch {
    // Page may be navigating
  }
}

export async function removeActiveTabGlow(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  try {
    await page.evaluate(() => {
      document.getElementById('__dev-browser-active-glow')?.remove();
      document.getElementById('__dev-browser-active-glow-style')?.remove();
    });
  } catch {
    // intentionally empty
  }
}
