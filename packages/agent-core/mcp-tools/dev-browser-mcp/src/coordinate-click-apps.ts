export interface CoordinateClickApp {
  pattern: RegExp;
  name: string;
  isCanvas: boolean;
  isGoogleWorkspace: boolean;
}

export const COORDINATE_CLICK_APPS: CoordinateClickApp[] = [
  { pattern: /docs\.google\.com/, name: 'Google Docs', isCanvas: false, isGoogleWorkspace: true },
  {
    pattern: /sheets\.google\.com/,
    name: 'Google Sheets',
    isCanvas: false,
    isGoogleWorkspace: true,
  },
  {
    pattern: /slides\.google\.com/,
    name: 'Google Slides',
    isCanvas: false,
    isGoogleWorkspace: true,
  },
  { pattern: /mail\.google\.com/, name: 'Gmail', isCanvas: false, isGoogleWorkspace: true },
  { pattern: /drive\.google\.com/, name: 'Google Drive', isCanvas: false, isGoogleWorkspace: true },
  {
    pattern: /calendar\.google\.com/,
    name: 'Google Calendar',
    isCanvas: false,
    isGoogleWorkspace: true,
  },
  { pattern: /figma\.com/, name: 'Figma', isCanvas: true, isGoogleWorkspace: false },
  { pattern: /canva\.com/, name: 'Canva', isCanvas: true, isGoogleWorkspace: false },
  { pattern: /miro\.com/, name: 'Miro', isCanvas: true, isGoogleWorkspace: false },
];

export function isCoordinateClickApp(url: string): CoordinateClickApp | null {
  return COORDINATE_CLICK_APPS.find((app) => app.pattern.test(url)) ?? null;
}

export function isCanvasApp(url: string): boolean {
  return COORDINATE_CLICK_APPS.some((app) => app.isCanvas && app.pattern.test(url));
}

export function isGoogleWorkspaceApp(url: string): boolean {
  return COORDINATE_CLICK_APPS.some((app) => app.isGoogleWorkspace && app.pattern.test(url));
}

export async function getElementCoordinates(
  element: import('playwright').ElementHandle,
): Promise<{ x: number; y: number; centerX: number; centerY: number } | null> {
  try {
    await element.scrollIntoViewIfNeeded();
    const box = await element.boundingBox();
    if (!box) return null;
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      centerX: Math.round(box.x + box.width / 2),
      centerY: Math.round(box.y + box.height / 2),
    };
  } catch {
    return null;
  }
}
