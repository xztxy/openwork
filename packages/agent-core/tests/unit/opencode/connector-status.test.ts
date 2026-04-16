/**
 * Unit tests for connector-status.ts (T024)
 *
 * Validates:
 * - formatBuiltInConnectorStatusSection returns '' for empty array (fast-path)
 * - All statuses appear in the output string
 * - "connected" / "not connected" wording is correct per status
 * - Output contains the <connected-integrations> wrapper tags
 */

import { describe, it, expect } from 'vitest';
import {
  formatBuiltInConnectorStatusSection,
  type BuiltInConnectorStatus,
} from '../../../src/opencode/completion/context-providers/connector-status.js';

const ALL_EIGHT: BuiltInConnectorStatus[] = [
  { displayName: 'Slack', connected: true },
  { displayName: 'Google', connected: false },
  { displayName: 'Jira', connected: true },
  { displayName: 'GitHub', connected: false },
  { displayName: 'monday.com', connected: false },
  { displayName: 'Notion', connected: false },
  { displayName: 'Lightdash', connected: true },
  { displayName: 'Datadog', connected: false },
];

describe('formatBuiltInConnectorStatusSection', () => {
  it('returns an empty string when the statuses array is empty', () => {
    expect(formatBuiltInConnectorStatusSection([])).toBe('');
  });

  it('wraps the output in <connected-integrations> tags', () => {
    const result = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    expect(result).toContain('<connected-integrations>');
    expect(result).toContain('</connected-integrations>');
  });

  it('marks connected connectors as "connected"', () => {
    const result = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    expect(result).toContain('Slack: connected');
    expect(result).toContain('Jira: connected');
    expect(result).toContain('Lightdash: connected');
  });

  it('marks disconnected connectors as "not connected"', () => {
    const result = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    expect(result).toContain('Google: not connected');
    expect(result).toContain('GitHub: not connected');
    expect(result).toContain('Datadog: not connected');
  });

  it('includes all 8 connector display names in the output', () => {
    const result = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    for (const s of ALL_EIGHT) {
      expect(result).toContain(s.displayName);
    }
  });

  it('handles a single connected entry correctly', () => {
    const result = formatBuiltInConnectorStatusSection([{ displayName: 'Jira', connected: true }]);
    expect(result).toContain('Jira: connected');
    expect(result).not.toContain('not connected');
  });

  it('handles a single disconnected entry correctly', () => {
    const result = formatBuiltInConnectorStatusSection([
      { displayName: 'GitHub', connected: false },
    ]);
    expect(result).toContain('GitHub: not connected');
  });

  it('mentions @<name> usage hint in the output', () => {
    const result = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    expect(result).toMatch(/@</);
  });

  it('is deterministic — same input produces same output', () => {
    const a = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    const b = formatBuiltInConnectorStatusSection(ALL_EIGHT);
    expect(a).toBe(b);
  });
});
