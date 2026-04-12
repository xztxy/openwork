export function isHttpNavigationUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function isBlankPanelNavigationUrl(url: string): boolean {
  return url === 'about:blank' || url.startsWith('about:blank#accomplish-browser-panel');
}

export function isReusableStartupPageUrl(url: string): boolean {
  return isBlankPanelNavigationUrl(url);
}
