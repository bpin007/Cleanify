import type { CleanSettings } from '../engine/protocol';

export const DEFAULT_SETTINGS: CleanSettings = {
  repair: true,
  ascii: false,
  asciiOptions: { emoji: 'keep', nonLatin: 'keep', guillemets: 'angle' },
};
