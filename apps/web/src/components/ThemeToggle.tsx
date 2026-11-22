import { useEffect, useState } from 'react';
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../theme/theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(() => loadThemePreference(safeLocalStorage()));

  useEffect(() => {
    applyThemePreference(document.documentElement, pref);
    saveThemePreference(safeLocalStorage(), pref);
  }, [pref]);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={pref === opt.value}
          onClick={() => setPref(opt.value)}
          className={
            'rounded-md px-3 py-1 transition-colors ' +
            (pref === opt.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-text')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
