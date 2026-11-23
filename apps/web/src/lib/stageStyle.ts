import type { Stage } from '@cleanify/engine';

/** Text colour class per stage (the AA-safe text variants, decision D12). */
export const STAGE_TEXT: Record<Stage, string> = {
  encoding: 'text-fix-encoding-text',
  ascii: 'text-fix-accent-text',
  invisible: 'text-fix-invisible-text',
  translate: 'text-fix-translate-text',
  safety: 'text-fix-safety-text',
};
