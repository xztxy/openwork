export function toAIFriendlyError(error: unknown, selector: string): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('strict mode violation')) {
    const countMatch = message.match(/resolved to (\d+) elements/);
    const count = countMatch ? countMatch[1] : 'multiple';
    return new Error(
      `Selector "${selector}" matched ${count} elements. ` +
        `Run browser_snapshot() to get updated refs, or use a more specific CSS selector.`,
    );
  }

  if (message.includes('intercepts pointer events') || message.includes('element is not visible')) {
    return new Error(
      `Element "${selector}" is blocked by another element (likely a modal, overlay, or cookie banner). ` +
        `Try: 1) Look for close/dismiss buttons in the snapshot, 2) Press Escape with browser_keyboard, ` +
        `3) Click outside the overlay. Then retry your action.`,
    );
  }

  if (message.includes('not visible') && !message.includes('Timeout')) {
    return new Error(
      `Element "${selector}" exists but is not visible. ` +
        `Try: 1) Use browser_scroll to scroll it into view, 2) Check if it's behind an overlay, ` +
        `3) Use browser_wait(condition="selector") to wait for it to appear.`,
    );
  }

  if (
    message.includes('waiting for') &&
    (message.includes('to be visible') || message.includes('Timeout'))
  ) {
    return new Error(
      `Element "${selector}" not found or not visible within timeout. ` +
        `The page may have changed. Run browser_snapshot() to see current page elements.`,
    );
  }

  if (
    message.includes('Target closed') ||
    message.includes('Session closed') ||
    message.includes('Page closed')
  ) {
    return new Error(
      `The page or tab was closed unexpectedly. ` +
        `Use browser_tabs(action="list") to see open tabs and browser_tabs(action="switch") to switch to the correct one.`,
    );
  }

  if (message.includes('net::ERR_') || message.includes('Navigation failed')) {
    return new Error(
      `Navigation failed: ${message}. ` +
        `Check if the URL is correct and the site is accessible. Try browser_screenshot() to see current state.`,
    );
  }

  return new Error(
    `${message}. ` +
      `Try taking a new browser_snapshot() to see the current page state before retrying.`,
  );
}
