/** Human-readable labels for stages, locations and summaries. */
import type { Location, Stage } from '@cleanify/engine';

export interface StageMeta {
  /** Group heading in the change list. */
  label: string;
  /** "42 encoding fixes" */
  noun: [singular: string, plural: string];
}

export const STAGES: Record<Stage, StageMeta> = {
  encoding: { label: 'Encoding repairs', noun: ['encoding fix', 'encoding fixes'] },
  ascii: { label: 'Accents and symbols', noun: ['accent or symbol', 'accents and symbols'] },
  invisible: {
    label: 'Invisible characters',
    noun: ['invisible character', 'invisible characters'],
  },
  translate: { label: 'Translations', noun: ['translation', 'translations'] },
  safety: { label: 'Spreadsheet safety', noun: ['formula guard', 'formula guards'] },
};

/** Order of groups in the UI. */
export const STAGE_ORDER: Stage[] = ['encoding', 'ascii', 'invisible', 'translate', 'safety'];

export const plural = (n: number, [one, many]: [string, string]) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** "Line 3, column 5" / "Row 2, column 3 (city)" / "Sheet1!B4". */
export function locationLabel(loc: Location): string {
  switch (loc.type) {
    case 'text':
      return `Line ${loc.line}, column ${loc.column}`;
    case 'csv':
      return `Row ${loc.row}, column ${loc.column}${loc.header ? ` (${loc.header})` : ''}${
        loc.charPos > 1 ? `, character ${loc.charPos}` : ''
      }`;
    case 'sheet':
      return `${loc.sheet}!${loc.cell}${loc.charPos > 1 ? `, character ${loc.charPos}` : ''}`;
  }
}

/** "42 encoding fixes · 118 accents and symbols · 3 invisible characters" */
export function summary(counts: Partial<Record<Stage, number>>): string {
  const parts = STAGE_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) =>
    plural(counts[s]!, STAGES[s].noun),
  );
  return parts.length > 0 ? parts.join(' · ') : 'No changes';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const ENCODING_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'utf-32le': 'UTF-32 LE',
  'utf-32be': 'UTF-32 BE',
  'windows-1252': 'Windows-1252',
  shift_jis: 'Shift-JIS',
};
