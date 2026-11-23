/** Which files the browser tool accepts (PROJECT.md section 7). */
import type { InputFormat } from '@cleanify/session';

import { CSV_EXTENSIONS, SHEET_EXTENSIONS, TEXT_EXTENSIONS, extensionOf } from '@cleanify/shared';

export { CSV_EXTENSIONS, SHEET_EXTENSIONS, TEXT_EXTENSIONS, extensionOf };

/** Warn above this size in browser mode (section 6). */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export const ACCEPT = [...TEXT_EXTENSIONS, ...CSV_EXTENSIONS, ...SHEET_EXTENSIONS]
  .map((e) => `.${e}`)
  .join(',');

export type FileCheck =
  { ok: true; format: InputFormat; large: boolean } | { ok: false; reason: string };

export function checkFile(name: string, size: number): FileCheck {
  const ext = extensionOf(name);
  const large = size > LARGE_FILE_BYTES;
  if (CSV_EXTENSIONS.includes(ext)) return { ok: true, format: 'csv', large };
  if (TEXT_EXTENSIONS.includes(ext)) return { ok: true, format: 'text', large };
  if (SHEET_EXTENSIONS.includes(ext)) return { ok: true, format: 'sheet', large };
  if (ext === 'xlsm' || ext === 'xlsb') {
    return {
      ok: false,
      reason: `.${ext} workbooks aren't supported. Save it as .xlsx in Excel first (File → Save As).`,
    };
  }
  return {
    ok: false,
    reason: `.${ext || '(no extension)'} files aren't supported. Use a text file (${TEXT_EXTENSIONS.join(', ')}), CSV/TSV, an Excel or OpenDocument spreadsheet, or an Access database.`,
  };
}

/**
 * "report.csv" → "report-clean.csv"; pasted text → "cleaned.txt". Workbooks are always
 * written as .xlsx: "old.xls" → "old-clean.xlsx", "shop.accdb" → "shop-clean.xlsx".
 */
export function cleanedName(name: string | null, format: InputFormat = 'text'): string {
  if (!name) return 'cleaned.txt';
  const dot = name.lastIndexOf('.');
  const base = dot <= 0 ? name : name.slice(0, dot);
  if (format === 'sheet') return `${base}-clean.xlsx`;
  return dot <= 0 ? `${name}-clean` : `${base}-clean${name.slice(dot)}`;
}
