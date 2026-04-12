import type { BrowserContext, Page } from 'playwright';
import { isClosedPageError, withTimeout } from './browser-runtime-utils';
import { navigatePageToUrl } from './browser-page-navigator';
import {
  selectReusableStartupPage,
  type CreatedTaskPage,
  type TaskPageLaunchMode,
} from './browser-page-service-state';
import { BrowserWindowController } from './browser-window-controller';
import { isReusableStartupPageUrl } from './navigation-url';
import type { ViewportSize } from './types';

export interface BrowserTaskPageFactoryOptions {
  headless: boolean;
  ensureBrowserContext: () => Promise<BrowserContext>;
  withPreservedForeground: <T>(operation: () => Promise<T>) => Promise<T>;
  windowController: BrowserWindowController;
}

export class BrowserTaskPageFactory {
  private reusableStartupPage: Page | null = null;

  constructor(private readonly options: BrowserTaskPageFactoryOptions) {}

  attachStartupPage(page: Page | null): void {
    if (page && isReusableStartupPageUrl(page.url())) {
      this.reusableStartupPage = page;
      page.on('close', () => {
        if (this.reusableStartupPage === page) this.reusableStartupPage = null;
      });
      return;
    }
    this.reusableStartupPage = null;
  }

  async acquirePageForExternalOpen(browserContext: BrowserContext): Promise<Page> {
    const reusableStartupPage = this.takeReusableStartupPage();
    if (reusableStartupPage) return reusableStartupPage;
    return withTimeout(browserContext.newPage(), 30000, 'Page creation timed out after 30s');
  }

  reset(): void {
    this.reusableStartupPage = null;
  }

  private takeReusableStartupPage(): Page | null {
    if (!this.reusableStartupPage || this.reusableStartupPage.isClosed()) {
      this.reusableStartupPage = null;
      return null;
    }
    const startupPage = this.reusableStartupPage;
    this.reusableStartupPage = null;
    return startupPage;
  }

  async createTaskPage(options: {
    activeTaskPageCount: number;
    browserContext: BrowserContext;
    initialUrl?: string;
    launchMode: TaskPageLaunchMode;
    name: string;
    viewport?: ViewportSize;
  }): Promise<CreatedTaskPage> {
    const launchMode = this.options.headless ? 'background-normal' : options.launchMode;
    const openPages = options.browserContext.pages().filter((candidate) => !candidate.isClosed());
    const reusableStartupPage = selectReusableStartupPage(
      this.reusableStartupPage,
      options.activeTaskPageCount,
      openPages,
    );

    if (reusableStartupPage) {
      this.reusableStartupPage = null;
      return this.createTaskPageFromReusableStartupPage({
        browserContext: options.browserContext,
        initialUrl: options.initialUrl,
        launchMode,
        name: options.name,
        page: reusableStartupPage,
        viewport: options.viewport,
      });
    }

    this.clearUnavailableReusableStartupPage(options.activeTaskPageCount);
    const anchorPage = openPages[0];

    if (this.options.headless || !anchorPage) {
      return this.createStandaloneTaskPage({
        browserContext: options.browserContext,
        initialUrl: options.initialUrl,
        name: options.name,
        viewport: options.viewport,
      });
    }

    return this.createAnchoredTaskPage({
      anchorPage,
      browserContext: options.browserContext,
      initialUrl: options.initialUrl,
      launchMode,
    });
  }

  async recycleOrClosePage(page: Page): Promise<void> {
    if (page.isClosed()) return;
    const activeContext = await this.options.ensureBrowserContext();
    if (!(await this.isLastOpenPage(page, activeContext))) {
      await page.close();
      return;
    }
    try {
      await this.prepareReusableStartupPage(page, activeContext);
    } catch (error) {
      if (!isClosedPageError(error)) await page.close().catch(() => {});
    }
  }

  private clearUnavailableReusableStartupPage(activeTaskPageCount: number): void {
    if (!this.reusableStartupPage) return;
    if (this.reusableStartupPage.isClosed() || activeTaskPageCount > 0) {
      this.reusableStartupPage = null;
    }
  }

  private async prepareReusableStartupPage(
    page: Page,
    browserContext?: BrowserContext,
  ): Promise<void> {
    if (page.isClosed()) {
      if (this.reusableStartupPage === page) this.reusableStartupPage = null;
      return;
    }
    if (!isReusableStartupPageUrl(page.url())) {
      await withTimeout(
        page.goto('about:blank'),
        30000,
        'Navigation timed out while preparing reusable startup page',
      );
    }
    this.attachStartupPage(page);
    await this.options.windowController.backgroundPage(page, browserContext);
  }

  private async waitForPageByTargetId(targetId: string): Promise<Page> {
    const activeContext = await this.options.ensureBrowserContext();
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      for (const candidate of activeContext.pages()) {
        if (candidate.isClosed()) continue;
        try {
          if ((await this.options.windowController.getTargetId(candidate)) === targetId)
            return candidate;
        } catch (error) {
          if (!isClosedPageError(error)) throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for background page target ${targetId}`);
  }

  private async createTaskPageFromReusableStartupPage(options: {
    browserContext: BrowserContext;
    initialUrl?: string;
    launchMode: TaskPageLaunchMode;
    name: string;
    page: Page;
    viewport?: ViewportSize;
  }): Promise<CreatedTaskPage> {
    const { browserContext, initialUrl, launchMode, name, page, viewport } = options;
    const targetId = await this.options.windowController.getTargetId(page, browserContext);

    if (viewport) await page.setViewportSize(viewport);

    let navigatedDuringCreate = false;
    if (initialUrl) {
      await navigatePageToUrl(name, page, initialUrl);
      navigatedDuringCreate = true;
    }

    await this.prepareReusedStartupPageForLaunch({ browserContext, launchMode, page, targetId });
    return {
      page,
      targetId,
      windowState: 'normal',
      backgroundAfterFirstFrame: launchMode === 'minimized-once',
      navigatedDuringCreate,
    };
  }

  private async prepareReusedStartupPageForLaunch(options: {
    browserContext: BrowserContext;
    launchMode: TaskPageLaunchMode;
    page: Page;
    targetId: string;
  }): Promise<void> {
    const { browserContext, launchMode, page, targetId } = options;
    if (launchMode === 'foreground') {
      await this.options.windowController.setNormalWindowState(page, targetId, browserContext);
      return;
    }
    if (launchMode === 'minimized-once') return;
    await this.options.windowController.restorePageWithoutForeground(
      page,
      targetId,
      browserContext,
    );
  }

  private async createStandaloneTaskPage(options: {
    browserContext: BrowserContext;
    initialUrl?: string;
    name: string;
    viewport?: ViewportSize;
  }): Promise<CreatedTaskPage> {
    return this.options.withPreservedForeground(async () => {
      const page = await withTimeout(
        options.browserContext.newPage(),
        30000,
        'Page creation timed out after 30s',
      );
      if (options.viewport) await page.setViewportSize(options.viewport);
      let navigatedDuringCreate = false;
      if (options.initialUrl) {
        await navigatePageToUrl(options.name, page, options.initialUrl);
        navigatedDuringCreate = true;
      }
      const targetId = await this.options.windowController.getTargetId(
        page,
        options.browserContext,
      );
      return {
        page,
        targetId,
        windowState: 'normal',
        backgroundAfterFirstFrame: false,
        navigatedDuringCreate,
      };
    });
  }

  private async createAnchoredTaskPage(options: {
    anchorPage: Page;
    browserContext: BrowserContext;
    initialUrl?: string;
    launchMode: TaskPageLaunchMode;
  }): Promise<CreatedTaskPage> {
    return this.options.withPreservedForeground(async () => {
      const cdpSession = await options.browserContext.newCDPSession(options.anchorPage);
      try {
        const { targetId } = (await cdpSession.send('Target.createTarget', {
          url: options.initialUrl ?? 'about:blank',
          background: options.launchMode !== 'foreground',
        })) as { targetId: string };
        const page = await this.waitForPageByTargetId(targetId);
        return {
          page,
          targetId,
          windowState: 'normal',
          backgroundAfterFirstFrame: false,
          navigatedDuringCreate: !!options.initialUrl,
        };
      } finally {
        await cdpSession.detach().catch(() => {});
      }
    });
  }

  private async isLastOpenPage(page: Page, browserContext: BrowserContext): Promise<boolean> {
    const openPages = browserContext.pages().filter((candidate) => !candidate.isClosed());
    return openPages.length === 1 && openPages[0] === page;
  }
}
