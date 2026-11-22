export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cleanify-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** Reads the saved preference. Storage can be missing or blocked, so never throw. */
export function loadThemePreference(
  storage: Pick<Storage, 'getItem'> | undefined,
): ThemePreference {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  pref: ThemePreference,
): void {
  try {
    if (pref === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage blocked (private mode etc.) — the choice just won't persist.
  }
}

/** Applies a preference to <html>: data-theme is only set when the user forces one. */
export function applyThemePreference(root: HTMLElement, pref: ThemePreference): void {
  if (pref === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = pref;
}
