import { describe, it, expect } from 'vitest';
import { toAIFriendlyError } from './errors.js';

describe('toAIFriendlyError', () => {
  const selector = '#my-button';

  it('returns element count hint on strict mode violation', () => {
    const err = new Error('strict mode violation: resolved to 5 elements');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('matched 5 elements');
    expect(result.message).toContain('browser_snapshot()');
  });

  it('uses "multiple" when strict mode violation has no count', () => {
    const err = new Error('strict mode violation');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('matched multiple elements');
  });

  it('detects pointer interception', () => {
    const err = new Error('element intercepts pointer events');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('blocked by another element');
  });

  it('detects element not visible (pointer events variant)', () => {
    const err = new Error('element is not visible');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('blocked by another element');
  });

  it('detects not-visible without timeout', () => {
    const err = new Error('element not visible on page');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('exists but is not visible');
    expect(result.message).toContain('browser_scroll');
  });

  it('detects timeout waiting for visibility', () => {
    const err = new Error('waiting for selector to be visible: Timeout 30000ms exceeded');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('not found or not visible within timeout');
    expect(result.message).toContain('browser_snapshot()');
  });

  it('detects waiting for + Timeout (separate)', () => {
    const err = new Error('Timeout waiting for something');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('not found or not visible within timeout');
  });

  it('detects Target closed', () => {
    const err = new Error('Target closed');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('page or tab was closed unexpectedly');
    expect(result.message).toContain('browser_tabs');
  });

  it('detects Session closed', () => {
    const err = new Error('Session closed');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('page or tab was closed unexpectedly');
  });

  it('detects Page closed', () => {
    const err = new Error('Page closed');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('page or tab was closed unexpectedly');
  });

  it('detects net::ERR_ errors', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('Navigation failed');
    expect(result.message).toContain('net::ERR_CONNECTION_REFUSED');
  });

  it('detects Navigation failed', () => {
    const err = new Error('Navigation failed because page was closed');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('Navigation failed');
    expect(result.message).toContain('browser_screenshot()');
  });

  it('falls back with browser_snapshot() suggestion', () => {
    const err = new Error('Something unexpected happened');
    const result = toAIFriendlyError(err, selector);
    expect(result.message).toContain('Something unexpected happened');
    expect(result.message).toContain('browser_snapshot()');
  });

  it('handles non-Error input', () => {
    const result = toAIFriendlyError('a plain string error', selector);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('a plain string error');
    expect(result.message).toContain('browser_snapshot()');
  });

  it('handles non-Error object input', () => {
    const result = toAIFriendlyError({ code: 42 }, selector);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('[object Object]');
  });

  it('includes selector in matched-elements messages', () => {
    const err = new Error('strict mode violation: resolved to 3 elements');
    const result = toAIFriendlyError(err, '.my-class');
    expect(result.message).toContain('".my-class"');
  });
});
