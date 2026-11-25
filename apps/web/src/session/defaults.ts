import type { MeUser } from '@cleanify/shared';
import type { CleanSettings } from '@cleanify/session';

export const DEFAULT_SETTINGS: CleanSettings = {
  repair: true,
  ascii: false,
  asciiScope: 'all',
  asciiOptions: { emoji: 'keep', nonLatin: 'keep', guillemets: 'angle' },
};

/** Saved default steps (from the account), with any missing ASCII options filled in. */
export function withDefaults(
  saved: NonNullable<MeUser['settings']['defaultStages']>,
): CleanSettings {
  const o = saved.asciiOptions;
  const asciiOptions = { ...DEFAULT_SETTINGS.asciiOptions };
  if (o.emoji) asciiOptions.emoji = o.emoji;
  if (o.nonLatin) asciiOptions.nonLatin = o.nonLatin;
  if (o.guillemets) asciiOptions.guillemets = o.guillemets;
  return { repair: saved.repair, ascii: saved.ascii, asciiScope: saved.asciiScope, asciiOptions };
}
