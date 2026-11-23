/**
 * Workbook adapter, the pure part (PROJECT.md section 13, "Excel adapters").
 *
 * A workbook's units are its text cells only; numbers, dates, booleans and
 * formulas are never touched. Reading and writing the file itself (ExcelJS,
 * SheetJS, mdb-reader) lives in `workbook.ts`, loaded lazily.
 *
 * For the before/after view a workbook is rendered as one line per text cell,
 * `Data!A2 │ value`, so the same diff view works for every format.
 */
import { appliedEdits } from '../changes/apply';
import { indexById, isApplied } from '../changes/model';
import type { PipelineUnit } from '../pipeline/analyze';
import type { Change, Location, SheetCell, SheetDoc } from '../types';
import { codePointsBetween } from './text';

export const sheetUnitId = (cell: Pick<SheetCell, 'sheetIndex' | 'address'>) =>
  `${cell.sheetIndex}!${cell.address}`;

/** Excel-style reference, quoting the sheet name when it needs it: 'My sheet'!B3. */
export function cellRef(sheet: string, address: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet);
  return `${plain ? sheet : `'${sheet.replace(/'/g, "''")}'`}!${address}`;
}

export function sheetLocator(cell: SheetCell): (offset: number) => Location {
  return (offset) => ({
    type: 'sheet',
    sheet: cell.sheet,
    cell: cell.address,
    charPos: codePointsBetween(cell.value, 0, offset) + 1,
  });
}

export function sheetUnits(doc: SheetDoc): PipelineUnit[] {
  return doc.cells.map((cell) => ({
    id: sheetUnitId(cell),
    text: cell.value,
    locate: sheetLocator(cell),
  }));
}

/**
 * Splits a cell's new text back into its rich-text runs. Unchanged characters stay in
 * the run they were in; each edit's output goes to the run where the edit starts, so
 * the run's font is kept (`edits` ascending, non-overlapping).
 */
export function distributeRuns(
  runs: readonly string[],
  edits: readonly { start: number; end: number; output: string }[],
): string[] {
  const out = runs.map(() => '');
  const starts: number[] = [];
  let total = 0;
  for (const r of runs) {
    starts.push(total);
    total += r.length;
  }
  const value = runs.join('');
  const runAt = (offset: number) => {
    for (let i = runs.length - 1; i >= 0; i--) if (starts[i]! <= offset && runs[i] !== '') return i;
    return 0;
  };
  const copy = (a: number, b: number) => {
    for (let i = 0; i < runs.length; i++) {
      const rs = starts[i]!;
      const re = rs + runs[i]!.length;
      const from = Math.max(a, rs);
      const to = Math.min(b, re);
      if (from < to) out[i] += value.slice(from, to);
    }
  };
  let pos = 0;
  for (const e of edits) {
    copy(pos, e.start);
    out[runAt(Math.min(e.start, Math.max(0, total - 1)))] += e.output;
    pos = e.end;
  }
  copy(pos, total);
  return out;
}

export interface EditedSheetCell {
  index: number;
  cell: SheetCell;
  /** The cell after the applied changes. */
  next: SheetCell;
  /** Applied changes in this cell (top-level and nested). */
  applied: Change[];
}

/** Cells that have at least one applied change, with their new value. */
export function editedSheetCells(doc: SheetDoc, changes: readonly Change[]): EditedSheetCell[] {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  const byUnit = new Map<string, Change[]>();
  const rootUnit = (c: Change): string | null => {
    let cur: Change | undefined = c;
    for (let depth = 0; cur && depth < 64; depth++) {
      if (cur.anchor.kind === 'original') return cur.anchor.unit;
      cur = byId.get(cur.anchor.parentId);
    }
    return null;
  };
  for (const c of changes) {
    if (!isApplied(c, byId, memo)) continue;
    const unit = rootUnit(c);
    if (unit === null) continue;
    const list = byUnit.get(unit) ?? [];
    list.push(c);
    byUnit.set(unit, list);
  }
  const out: EditedSheetCell[] = [];
  doc.cells.forEach((cell, index) => {
    const unit = sheetUnitId(cell);
    const applied = byUnit.get(unit);
    if (!applied) return;
    const edits = appliedEdits(unit, cell.value, applied).reverse();
    let value = cell.value;
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i]!;
      value = value.slice(0, e.start) + e.output + value.slice(e.end);
    }
    const next: SheetCell = { ...cell, value };
    if (cell.runs) next.runs = distributeRuns(cell.runs, edits);
    out.push({ index, cell, next, applied });
  });
  return out;
}

export function applySheet(doc: SheetDoc, changes: readonly Change[]): SheetDoc {
  const cells = doc.cells.slice();
  for (const e of editedSheetCells(doc, changes)) cells[e.index] = e.next;
  return { ...doc, cells };
}

const SEP = ' │ ';

/** The text view of a workbook, and where each cell's value starts in it. */
export function renderSheet(doc: SheetDoc): { text: string; valueStarts: number[] } {
  const parts: string[] = [];
  const valueStarts: number[] = [];
  let length = 0;
  doc.cells.forEach((cell, i) => {
    const prefix = (i === 0 ? '' : '\n') + cellRef(cell.sheet, cell.address) + SEP;
    parts.push(prefix, cell.value);
    valueStarts.push(length + prefix.length);
    length += prefix.length + cell.value.length;
  });
  return { text: parts.join(''), valueStarts };
}
