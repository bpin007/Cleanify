import { describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
} from '../src/theme/theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('resolveTheme', () => {
  it('follows the OS when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('a forced choice wins over the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('theme persistence', () => {
  it('defaults to system when nothing is saved or the value is junk', () => {
    expect(loadThemePreference(memoryStorage())).toBe('system');
    expect(loadThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('system');
    expect(loadThemePreference(undefined)).toBe('system');
  });

  it('round-trips light/dark and clears the key for system', () => {
    const s = memoryStorage();
    saveThemePreference(s, 'dark');
    expect(loadThemePreference(s)).toBe('dark');
    saveThemePreference(s, 'system');
    expect(s.data.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadThemePreference(blocked)).toBe('system');
    expect(() => saveThemePreference(blocked, 'dark')).not.toThrow();
  });
});
