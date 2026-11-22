/** Which files the browser tool accepts (PROJECT.md section 7). */
import type { InputFormat } from '../engine/protocol';

export const TEXT_EXTENSIONS = ['txt', 'log', 'md', 'json', 'xml', 'sql'];
export const CSV_EXTENSIONS = ['csv', 'tsv'];
/** Spreadsheet and database files: supported later in Phase 2. */
export const LATER_EXTENSIONS = ['xlsx', 'xls', 'ods', 'accdb', 'mdb'];

/** Warn above this size in browser mode (section 6). */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export const ACCEPT = [...TEXT_EXTENSIONS, ...CSV_EXTENSIONS].map((e) => `.${e}`).join(',');

export type FileCheck =
  { ok: true; format: InputFormat; large: boolean } | { ok: false; reason: string };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function checkFile(name: string, size: number): FileCheck {
  const ext = extensionOf(name);
  const large = size > LARGE_FILE_BYTES;
  if (CSV_EXTENSIONS.includes(ext)) return { ok: true, format: 'csv', large };
  if (TEXT_EXTENSIONS.includes(ext)) return { ok: true, format: 'text', large };
  if (LATER_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: `.${ext} files aren't supported yet: Excel and Access support is coming soon. For now, save the sheet as CSV.`,
    };
  }
  return {
    ok: false,
    reason: `.${ext || '(no extension)'} files aren't supported. Use a text file (${TEXT_EXTENSIONS.join(', ')}) or CSV/TSV.`,
  };
}

/** "report.csv" → "report-clean.csv"; pasted text → "cleaned.txt". */
export function cleanedName(name: string | null): string {
  if (!name) return 'cleaned.txt';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? `${name}-clean` : `${name.slice(0, dot)}-clean${name.slice(dot)}`;
}
