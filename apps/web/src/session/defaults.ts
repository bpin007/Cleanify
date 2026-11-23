import type { CleanSettings } from '../engine/protocol';

export const DEFAULT_SETTINGS: CleanSettings = {
  repair: true,
  ascii: false,
  asciiScope: 'all',
  asciiOptions: { emoji: 'keep', nonLatin: 'keep', guillemets: 'angle' },
};
