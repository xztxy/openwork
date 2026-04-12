export interface ServeOptions {
  port?: number; // default 9224
  headless?: boolean; // default false (shows the browser window)
  cdpPort?: number; // default 9225 (Chrome DevTools Protocol port)
  profileDir?: string; // persistent profile directory; defaults to ./.browser-data
  useSystemChrome?: boolean; // try system Chrome before Playwright Chromium; default true
}

export interface ViewportSize {
  width: number;
  height: number;
}

// Describes WHY a page is being opened — drives foreground/background policy.
// background-normal : shell/recovery work, must not consume released URLs
// browser-tool-open : only intent allowed to restore released pages & trigger first-open logic
// foreground        : explicit user-facing open/focus
export type PageLaunchIntent = 'background-normal' | 'browser-tool-open' | 'foreground';

export interface GetPageRequest {
  name: string;
  viewport?: ViewportSize;
  initialUrl?: string;
  launchIntent?: PageLaunchIntent;
  keepForegroundUntilFirstFrame?: boolean; // legacy compat; prefer launchIntent
}

export interface GetPageResponse {
  wsEndpoint: string;
  name: string;
  targetId: string;
  created: boolean;
}

export interface ListPagesResponse {
  pages: string[];
}

export interface ServerInfoResponse {
  wsEndpoint: string;
  browserReady: boolean;
}

export interface PageStateResponse {
  name: string;
  targetId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}
