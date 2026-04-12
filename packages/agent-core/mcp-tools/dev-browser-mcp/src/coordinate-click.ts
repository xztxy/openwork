// Apps that require coordinate-based mouse events because DOM .click() doesn't
// trigger their canvas or event-delegation handlers.
const COORDINATE_CLICK_APP_NAMES = new Set([
  'Google Docs',
  'Google Sheets',
  'Google Slides',
  'Gmail',
  'Google Drive',
  'Figma',
  'Canva',
  'Miro',
]);

export function shouldUseCoordinateClick(url: string, appName: string | null): boolean {
  if (!appName) {
    return false;
  }
  return COORDINATE_CLICK_APP_NAMES.has(appName);
}
