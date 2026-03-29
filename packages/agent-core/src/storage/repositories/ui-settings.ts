import type { ThemePreference } from '../../types/storage.js';
import { getDatabase } from '../database.js';

interface AppSettingsUiRow {
  debug_mode: number;
  onboarding_complete: number;
  theme: string;
  run_in_background: number;
  notifications_enabled: number;
}

function getUiRow(): AppSettingsUiRow {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT debug_mode, onboarding_complete, theme, run_in_background, notifications_enabled FROM app_settings WHERE id = 1',
    )
    .get() as AppSettingsUiRow;
}

export const VALID_THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function getDebugMode(): boolean {
  return getUiRow().debug_mode === 1;
}

export function setDebugMode(enabled: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET debug_mode = ? WHERE id = 1').run(enabled ? 1 : 0);
}

export function getOnboardingComplete(): boolean {
  return getUiRow().onboarding_complete === 1;
}

export function setOnboardingComplete(complete: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET onboarding_complete = ? WHERE id = 1').run(complete ? 1 : 0);
}

export function getTheme(): ThemePreference {
  const row = getUiRow();
  const value = row.theme as ThemePreference;
  if (VALID_THEMES.includes(value)) {
    return value;
  }
  return 'system';
}

export function setTheme(theme: ThemePreference): void {
  if (!VALID_THEMES.includes(theme)) {
    throw new Error(`Invalid theme value: ${theme}`);
  }
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET theme = ? WHERE id = 1').run(theme);
}

export function getRunInBackground(): boolean {
  return getUiRow().run_in_background === 1;
}

export function setRunInBackground(enabled: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET run_in_background = ? WHERE id = 1').run(enabled ? 1 : 0);
}

export function getNotificationsEnabled(): boolean {
  return getUiRow().notifications_enabled === 1;
}

export function setNotificationsEnabled(enabled: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET notifications_enabled = ? WHERE id = 1').run(enabled ? 1 : 0);
}
