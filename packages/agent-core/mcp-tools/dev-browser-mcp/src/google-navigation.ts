export function normalizeNavigationUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export interface NavigationPlan {
  finalUrl: string;
  steps: string[];
  requiresLogin: boolean;
}

export function buildGoogleNavigationPlan(url: string): NavigationPlan {
  const normalized = normalizeNavigationUrl(url);
  const requiresLogin =
    /accounts\.google\.com/.test(url) || /\/login/.test(url) || /\/signin/.test(url);
  return { finalUrl: normalized, steps: [normalized], requiresLogin };
}

export function buildGoogleLoginRedirectUrl(targetUrl: string): string {
  return `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(targetUrl)}`;
}

export function buildCurrentPageLinkNavigationPlan(link: string): NavigationPlan {
  return { finalUrl: link, steps: [link], requiresLogin: false };
}

export function buildGoogleMarketingSignInNavigationPlan(
  linkHref: string,
  targetUrl: string,
): NavigationPlan {
  return { finalUrl: targetUrl, steps: [linkHref, targetUrl], requiresLogin: true };
}

export function isGoogleWorkspaceMarketingUrl(url: string): boolean {
  return /workspace\.google\.com/.test(url) && !/docs\.google\.com/.test(url);
}
