/**
 * Reading and writing workbooks (PROJECT.md sections 7 and 13, decision C1).
 *
 * - .xlsx: read and written with ExcelJS; only text cells change, so formulas,
 *   numbers, dates and styles are kept. Charts and pivot tables (which ExcelJS
 *   drops) are found in the zip on load and reported as a warning.
 * - .xls / .ods: read with SheetJS Community Edition (installed from cdn.sheetjs.com),
 *   values, formulas, number formats and merges copied into a new ExcelJS workbook,
 *   written as .xlsx with a "styles not kept" warning.
 * - .accdb / .mdb: read with mdb-reader; one sheet per table, the real column names
 *   as a bold header row, numbers, dates and booleans kept as such.
 *
 * Every library is imported lazily: none of them weighs on the first page load.
 * mdb-reader needs Node's Buffer; the `buffer` package provides it in the browser.
 */
import type ExcelJSNs from 'exceljs';
import type { EngineWarning, SheetCell, SheetDoc, SheetSource } from '../types';
import { sheetUnitId } from './sheet';
import { partsDroppedOnExport, zipEntryNames } from './zip';

type Workbook = ExcelJSNs.Workbook;
type Worksheet = ExcelJSNs.Worksheet;
type CellValue = ExcelJSNs.CellValue;

interface Book {
  workbook: Workbook;
  /** Original value of every text cell, by unit id, so a save can rebuild rich text and links. */
  originals: Map<string, CellValue>;
}

async function loadExcelJS(): Promise<typeof ExcelJSNs> {
  const mod = (await import('exceljs')) as unknown as { default?: typeof ExcelJSNs };
  return (mod.default ?? mod) as typeof ExcelJSNs;
}

/** mdb-reader and iconv-lite expect Node's global Buffer; the browser needs the polyfill. */
export async function ensureBuffer(): Promise<void> {
  const g = globalThis as { Buffer?: unknown };
  if (g.Buffer) return;
  const mod = await import('buffer');
  g.Buffer = mod.Buffer;
}

export function sheetSourceOf(fileName: string): SheetSource | null {
  const ext = /\.([a-z]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext === 'xlsx' || ext === 'xls' || ext === 'ods' || ext === 'accdb' || ext === 'mdb'
    ? ext
    : null;
}

const VT = { Merge: 1, String: 3, Hyperlink: 5, RichText: 8 } as const;

function textCellsOf(workbook: Workbook): {
  sheets: string[];
  cells: SheetCell[];
  originals: Map<string, CellValue>;
} {
  const sheets: string[] = [];
  const cells: SheetCell[] = [];
  const originals = new Map<string, CellValue>();
  workbook.worksheets.forEach((ws: Worksheet, sheetIndex) => {
    sheets.push(ws.name);
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => {
        const type = c.type as number;
        let cell: SheetCell | null = null;
        const base = { sheet: ws.name, sheetIndex, address: c.address };
        if (type === VT.String && typeof c.value === 'string') {
          cell = { ...base, kind: 'string', value: c.value };
        } else if (type === VT.RichText) {
          const runs = (c.value as ExcelJSNs.CellRichTextValue).richText.map((r) => r.text ?? '');
          cell = { ...base, kind: 'rich', value: runs.join(''), runs };
        } else if (type === VT.Hyperlink) {
          const text = (c.value as ExcelJSNs.CellHyperlinkValue).text;
          if (typeof text === 'string') cell = { ...base, kind: 'link', value: text };
        }
        if (cell && cell.value !== '') {
          cells.push(cell);
          originals.set(sheetUnitId(cell), c.value);
        }
      });
    });
  });
  return { sheets, cells, originals };
}

function makeDoc(workbook: Workbook, source: SheetSource, warnings: EngineWarning[]): SheetDoc {
  const { sheets, cells, originals } = textCellsOf(workbook);
  warnings.push({
    kind: 'text-cells-only',
    severity: 'info',
    message:
      `${cells.length.toLocaleString('en')} text cell${cells.length === 1 ? '' : 's'} in ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}. ` +
      'Only text cells are checked and changed; numbers, dates and formulas are kept exactly as they are.',
  });
  const book: Book = { workbook, originals };
  return { format: 'sheet', source, sheets, cells, warnings, book };
}

export async function readXlsx(bytes: Uint8Array): Promise<SheetDoc> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const warnings: EngineWarning[] = [];
  const dropped = partsDroppedOnExport(zipEntryNames(bytes));
  if (dropped.length > 0) {
    warnings.push({
      kind: 'export-drops-parts',
      severity: 'high',
      message:
        `This workbook has ${joinList(dropped)}. The cleaned file will not have them: ` +
        'the library that writes .xlsx files can’t keep them. Your cells, formulas and styles are kept.',
    });
  }
  return makeDoc(workbook, 'xlsx', warnings);
}

/** .xls and .ods, read with SheetJS CE and copied into a new ExcelJS workbook. */
export async function readLegacySheet(bytes: Uint8Array, source: 'xls' | 'ods'): Promise<SheetDoc> {
  const [XLSX, ExcelJS] = await Promise.all([import('xlsx'), loadExcelJS()]);
  const wbIn = XLSX.read(bytes, {
    type: 'array',
    cellDates: true,
    cellNF: true,
    cellFormula: true,
  });
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  for (const name of wbIn.SheetNames) {
    const sIn = wbIn.Sheets[name]!;
    const ws = workbook.addWorksheet(name.slice(0, 31));
    const ref = sIn['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cIn = sIn[XLSX.utils.encode_cell({ r, c })] as
          { t: string; v?: unknown; f?: string; z?: string | number } | undefined;
        if (!cIn || cIn.t === 'z') continue;
        const cell = ws.getCell(r + 1, c + 1);
        const value =
          cIn.t === 'e' ? undefined : (cIn.v as string | number | boolean | Date | undefined);
        if (cIn.f) cell.value = { formula: excelFormula(cIn.f), result: value } as CellValue;
        else if (value !== undefined) cell.value = value;
        if (typeof cIn.z === 'string' && cIn.z !== 'General') cell.numFmt = cIn.z;
      }
    }
    for (const m of sIn['!merges'] ?? []) {
      ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
    }
    (sIn['!cols'] ?? []).forEach((col, i) => {
      if (col?.wch) ws.getColumn(i + 1).width = col.wch;
    });
  }
  const label =
    source === 'xls' ? 'an old Excel file (.xls)' : 'an OpenDocument spreadsheet (.ods)';
  return makeDoc(workbook, source, [
    {
      kind: 'styles-not-kept',
      severity: 'warning',
      message:
        `This is ${label}. It will be saved as .xlsx with its values, formulas, number formats ` +
        'and merged cells, but not its styles (fonts, colours, borders).',
    },
  ]);
}

const SHEET_NAME_BAD = /[[\]:*?/\\]/g;

export function sheetNameFor(table: string, used: Set<string>): string {
  const base = table.replace(SHEET_NAME_BAD, '_').slice(0, 31) || 'Table';
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Microsoft Access (.accdb, .mdb): one sheet per table, exported as .xlsx. */
export async function readAccess(bytes: Uint8Array, source: 'accdb' | 'mdb'): Promise<SheetDoc> {
  await ensureBuffer();
  const [{ default: MDBReader }, ExcelJS] = await Promise.all([
    import('mdb-reader'),
    loadExcelJS(),
  ]);
  const BufferCtor = (globalThis as unknown as { Buffer: { from(b: Uint8Array): Buffer } }).Buffer;
  let reader: InstanceType<typeof MDBReader>;
  try {
    reader = new MDBReader(BufferCtor.from(bytes));
    reader.getTableNames();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      /password/i.test(msg)
        ? 'This database is password-protected. Remove the password in Access and try again.'
        : `This file could not be read as an Access database (${msg}).`,
      { cause: e },
    );
  }
  const workbook = new ExcelJS.Workbook();
  const used = new Set<string>();
  const skipped: string[] = [];
  for (const tableName of reader.getTableNames()) {
    const table = reader.getTable(tableName);
    const ws = workbook.addWorksheet(sheetNameFor(tableName, used));
    const columns = table.getColumns();
    const kept = columns.filter((col) => {
      const ok = !['binary', 'ole', 'complex'].includes(col.type);
      if (!ok) skipped.push(`${tableName}.${col.name}`);
      return ok;
    });
    const header = ws.addRow(kept.map((col) => col.name));
    header.font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const rows = table.getData({ columns: kept.map((col) => col.name) });
    // Access keeps rows in storage order, which changes as rows are edited; the
    // AutoNumber column (when there is one) gives the order people expect.
    const auto = kept.find((col) => col.autoLong);
    if (auto) rows.sort((a, b) => Number(a[auto.name] ?? 0) - Number(b[auto.name] ?? 0));
    for (const row of rows) {
      ws.addRow(kept.map((col) => accessValue(row[col.name], col.type)));
    }
    kept.forEach((col, i) => {
      const column = ws.getColumn(i + 1);
      if (col.type === 'datetime') column.numFmt = 'yyyy-mm-dd hh:mm:ss';
      else if (col.type === 'currency') column.numFmt = '#,##0.00';
      column.width = Math.min(50, Math.max(10, col.name.length + 2));
    });
  }
  const warnings: EngineWarning[] = [
    {
      kind: 'converted',
      severity: 'info',
      message:
        'Access databases are saved as an Excel workbook (.xlsx): one sheet per table, ' +
        'with the column names as the first row. Numbers, dates and yes/no values stay as they are.',
    },
  ];
  if (skipped.length > 0) {
    warnings.push({
      kind: 'skipped-data',
      severity: 'warning',
      message:
        `${skipped.length} column${skipped.length === 1 ? '' : 's'} with pictures, attachments or other binary data ` +
        `can’t go into a spreadsheet and will be left out: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}.`,
    });
  }
  return makeDoc(workbook, source, warnings);
}

function accessValue(v: unknown, type: string): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  }
  if ((type === 'currency' || type === 'numeric') && typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')
    return v;
  return String(v);
}

/** Reads any supported workbook into a SheetDoc. */
export async function readWorkbook(bytes: Uint8Array, source: SheetSource): Promise<SheetDoc> {
  switch (source) {
    case 'xlsx':
      return readXlsx(bytes);
    case 'xls':
    case 'ods':
      return readLegacySheet(bytes, source);
    case 'accdb':
    case 'mdb':
      return readAccess(bytes, source);
  }
}

/** Writes the document (usually the output of applyChanges) as .xlsx bytes. */
export async function writeWorkbook(doc: SheetDoc): Promise<Uint8Array> {
  const { workbook, originals } = doc.book as Book;
  for (const cell of doc.cells) {
    const ws = workbook.worksheets[cell.sheetIndex];
    if (!ws) continue;
    const original = originals.get(sheetUnitId(cell));
    const target = ws.getCell(cell.address);
    if (cell.kind === 'rich' && cell.runs) {
      const runs = (original as ExcelJSNs.CellRichTextValue).richText;
      const richText = runs
        .map((r, i) => ({ ...r, text: cell.runs![i] ?? '' }))
        .filter((r) => r.text !== '');
      target.value = richText.length > 0 ? { richText } : '';
    } else if (cell.kind === 'link') {
      target.value = { ...(original as ExcelJSNs.CellHyperlinkValue), text: cell.value };
    } else {
      target.value = cell.value;
    }
  }
  // Formulas that read changed text get their cached results recalculated on open.
  workbook.calcProperties.fullCalcOnLoad = true;
  const out = await workbook.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

/**
 * .ods formulas can come back from SheetJS with their namespace (`msoxl:=SUM(B2:B3)`
 * when Excel wrote the file, `of:=SUM([.B2:.B3])` for OpenFormula). ExcelJS wants
 * the plain A1 form without "=".
 */
export function excelFormula(f: string): string {
  const of = /^of:=/i.test(f);
  let out = f.replace(/^(?:msoxl|of|oooc):=/i, '').replace(/^=/, '');
  if (of) {
    out = out
      .replace(
        /\[\$?'?([^\].']*?)'?\.([A-Z$]+[0-9$]+)(?::\.([A-Z$]+[0-9$]+))?\]/g,
        (_m, sheet: string, a: string, b?: string) => {
          const ref = b ? `${a}:${b}` : a;
          return sheet ? `'${sheet}'!${ref}` : ref;
        },
      )
      .replace(/;/g, ',');
  }
  return out;
}

function joinList(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
