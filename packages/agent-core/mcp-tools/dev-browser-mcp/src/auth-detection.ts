import type { Page } from 'playwright';

export interface AuthDetection {
  isAuthPage: boolean;
  reason?: string;
}

const AUTH_URL_PATTERNS = [
  /accounts\.google\.com/,
  /login\./,
  /signin\./,
  /auth\./,
  /\/login/,
  /\/signin/,
  /\/sign-in/,
  /\/authenticate/,
];

const AUTH_SNAPSHOT_KEYWORDS = [
  'sign in',
  'log in',
  'login',
  'sign up',
  'create account',
  'forgot password',
  'enter your password',
  'enter your email',
  'captcha',
  'verify you are human',
];

export function detectAuthPage(signals: {
  url: string;
  title: string;
  snapshot?: string;
}): AuthDetection {
  const urlLower = signals.url.toLowerCase();
  const titleLower = signals.title.toLowerCase();

  for (const pattern of AUTH_URL_PATTERNS) {
    if (pattern.test(urlLower)) {
      return { isAuthPage: true, reason: `URL matches auth pattern: ${pattern}` };
    }
  }

  for (const keyword of AUTH_SNAPSHOT_KEYWORDS) {
    if (titleLower.includes(keyword)) {
      return { isAuthPage: true, reason: `Title contains "${keyword}"` };
    }
  }

  if (signals.snapshot) {
    const snapshotLower = signals.snapshot.toLowerCase();
    for (const keyword of AUTH_SNAPSHOT_KEYWORDS) {
      if (snapshotLower.includes(keyword)) {
        return { isAuthPage: true, reason: `Snapshot contains "${keyword}"` };
      }
    }
  }

  return { isAuthPage: false };
}

export async function detectAuthPageFromSnapshot(
  rawSnapshot: string,
  url: string,
  title: string,
): Promise<AuthDetection> {
  return detectAuthPage({ url, title, snapshot: rawSnapshot });
}

export function formatAuthDetectionBlock(detection: AuthDetection, page: Page): string {
  if (!detection.isAuthPage) return '';
  return [
    '\n⚠️  AUTH PAGE DETECTED',
    `URL: ${page.url()}`,
    detection.reason ? `Reason: ${detection.reason}` : '',
    'The page requires authentication. Sign in before continuing.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function detectNavigationRedirect(
  requestedUrl: string,
  finalUrl: string,
  wasGoogleRewrite: boolean,
): boolean {
  if (wasGoogleRewrite) return false;
  try {
    const req = new URL(requestedUrl);
    const fin = new URL(finalUrl);
    return req.hostname !== fin.hostname;
  } catch {
    return false;
  }
}

export function detectBlankSnapshot(rawSnapshot: string, url: string): boolean {
  if (!url || url === 'about:blank') return true;
  const trimmed = rawSnapshot.trim();
  return trimmed.length < 20 || trimmed === '- document:';
}

export function detectGmailLoadingState(rawSnapshot: string, url: string): boolean {
  if (!/mail\.google\.com/.test(url)) return false;
  return rawSnapshot.includes('Loading') && !rawSnapshot.includes('Compose');
}

export { normalizeNavigationUrl, buildGoogleNavigationPlan } from './google-navigation.js';
export { isGoogleWorkspaceEditorUrl } from './google-docs.js';
