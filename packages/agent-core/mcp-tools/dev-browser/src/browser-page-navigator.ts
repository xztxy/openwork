import type { Page } from 'playwright';
import { withTimeout } from './browser-runtime-utils';
import { isBlankPanelNavigationUrl, isHttpNavigationUrl } from './navigation-url';

export async function navigatePageToUrl(name: string, page: Page, url: string): Promise<void> {
  if (!isHttpNavigationUrl(url) && !isBlankPanelNavigationUrl(url)) {
    throw new Error('url must be an http/https URL or a blank-panel navigation URL');
  }
  await withTimeout(page.goto(url), 30000, `Navigation timed out for ${name}`);
}
