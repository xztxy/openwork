export function shouldUseCoordinateClick(url: string, appName: string | null): boolean {
  if (!appName) return false;
  // Coordinate-based mouse events work better in apps that use canvas rendering
  // or event-delegation patterns where DOM .click() doesn't trigger handlers
  return appName !== null;
}
