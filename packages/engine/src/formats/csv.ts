/**
 * CSV adapter — PROJECT.md section 13 (correction C2).
 *
 * Our own RFC 4180 tokenizer records every cell's exact span in the source.
 * Output is written by splicing: only edited cells are rewritten, every other
 * character is copied unchanged, so with no accepted changes the output is
 * byte-identical to the input (section 19 #1). Papa Parse is used only to
 * guess the delimiter (and, in tests, as an oracle).
 */
import Papa from 'papaparse';
import { applyToUnit } from '../changes/apply';
import { indexById, isApplied } from '../changes/model';
import type { PipelineUnit } from '../pipeline/analyze';
import type { Change, CsvCell, CsvDoc, EngineWarning, Location } from '../types';
import { codePointsBetween } from './text';

export interface CsvOptions {
  delimiter?: string;
  /** Treat row 1 as the header (used for locations). Default true. */
  hasHeader?: boolean;
}

const DELIMITERS = [',', ';', '\t', '|'];

export function detectDelimiter(source: string): string {
  if (source.length === 0) return ',';
  const sample = source.slice(0, 64 * 1024);
  // skipEmptyLines: otherwise a trailing blank line counts as a 1-field row and
  // makes the right delimiter look inconsistent.
  const guess = Papa.parse(sample, {
    preview: 50,
    delimitersToGuess: DELIMITERS,
    skipEmptyLines: true,
  }).meta.delimiter;
  return DELIMITERS.includes(guess) ? guess : ',';
}

export const cellUnitId = (row: number, column: number) => `r${row}c${column}`;

/** 1-based physical line number of a UTF-16 offset (CRLF, CR and LF each end a line). */
function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    const c = source.charCodeAt(i);
    if (c === 0x0a || (c === 0x0d && source.charCodeAt(i + 1) !== 0x0a)) line++;
  }
  return line;
}

export function parseCsv(source: string, options: CsvOptions = {}): CsvDoc {
  const delimiter = options.delimiter ?? detectDelimiter(source);
  const hasHeader = options.hasHeader ?? true;
  const cells: CsvCell[] = [];
  const warnings: EngineWarning[] = [];
  const len = source.length;
  const d = delimiter.charCodeAt(0);

  let row = 1;
  let column = 1;
  let i = 0;
  if (len === 0)
    return { format: 'csv', source, delimiter, hasHeader, cells, rowCount: 0, warnings };

  for (;;) {
    const start = i;
    let value: string;
    let quoted = false;
    let end: number;

    if (source.charCodeAt(i) === 0x22) {
      quoted = true;
      let j = i + 1;
      value = '';
      let closed = false;
      for (;;) {
        const q = source.indexOf('"', j);
        if (q < 0) {
          value += source.slice(j);
          j = len;
          break;
        }
        value += source.slice(j, q);
        if (source.charCodeAt(q + 1) === 0x22) {
          value += '"';
          j = q + 2;
        } else {
          j = q + 1;
          closed = true;
          break;
        }
      }
      if (!closed) {
        const line = lineOf(source, start);
        warnings.push({
          kind: 'unterminated-quote',
          severity: 'warning',
          message: `Unclosed quote starting on line ${line} (row ${row}, column ${column}): the rest of the file was read as one cell.`,
          location: { type: 'csv', row, column, charPos: 1 },
        });
      }
      // Characters between a closing quote and the next delimiter/newline (not RFC 4180,
      // but seen in the wild) are kept as part of the value, as Papa Parse does.
      let k = j;
      while (k < len) {
        const c = source.charCodeAt(k);
        if (c === d || c === 0x0a || c === 0x0d) break;
        k++;
      }
      value += source.slice(j, k);
      end = k;
    } else {
      let k = i;
      while (k < len) {
        const c = source.charCodeAt(k);
        if (c === d || c === 0x0a || c === 0x0d) break;
        k++;
      }
      value = source.slice(i, k);
      end = k;
    }

    cells.push({ row, column, value, quoted, start, end });

    if (end >= len) break;
    const c = source.charCodeAt(end);
    if (c === d) {
      column++;
      i = end + 1;
      continue; // if i === len, the loop records one more (empty) field
    }
    // Newline: CRLF, LF or CR
    i = end + (c === 0x0d && source.charCodeAt(end + 1) === 0x0a ? 2 : 1);
    if (i >= len) break; // a trailing newline does not start a new row (#2)
    row++;
    column = 1;
  }

  return { format: 'csv', source, delimiter, hasHeader, cells, rowCount: row, warnings };
}

function headerFor(doc: CsvDoc): (row: number, column: number) => string | undefined {
  const headers = new Map<number, string>();
  if (doc.hasHeader) for (const c of doc.cells) if (c.row === 1) headers.set(c.column, c.value);
  return (row, column) => (row > 1 ? headers.get(column) : undefined);
}

export function csvUnits(doc: CsvDoc): PipelineUnit[] {
  const header = headerFor(doc);
  return doc.cells
    .filter((c) => c.value.length > 0)
    .map((c) => ({
      id: cellUnitId(c.row, c.column),
      text: c.value,
      locate: (offset: number): Location => {
        const h = header(c.row, c.column);
        return {
          type: 'csv',
          row: c.row,
          column: c.column,
          ...(h !== undefined ? { header: h } : {}),
          charPos: codePointsBetween(c.value, 0, offset) + 1,
        };
      },
    }));
}

/** A real number, which the formula guard must never touch (C10): -42, +1.5, -1,234.56, 1e5, 12% */
const NUMBER = /^[+-]?(\d+([.,]\d+)*|\d*[.,]\d+)([eE][+-]?\d+)?%?$/;

/** Would a spreadsheet app run this cell value as a formula? (= + - @ tab CR, but not a number) */
export function isFormulaRisk(value: string): boolean {
  return value.length >= 2 && /^[=+\-@\t\r]/.test(value) && !NUMBER.test(value.trim());
}

const GUARD = 'formula-guard';
const shown = (c: string) => (c === '\t' ? 'a tab' : c === '\r' ? 'a carriage return' : `“${c}”`);

/**
 * Formula-injection guard (section 17, decisions D8 and D11): proposes inserting an
 * apostrophe at the start of every cell that could start with = + - @ (or tab/CR) in
 * the FINAL output: as it is now, with the default decisions, or with every change
 * accepted (full-width ＝SUM becomes =SUM in Stage 2). It is a visible change, and
 * applyCsv only inserts the apostrophe if the final value really is a formula risk.
 */
export function formulaGuards(doc: CsvDoc, changes: readonly Change[]): Change[] {
  const groups = groupByUnit(changes);
  const allGroups = groupByUnit(changes.map((c) => ({ ...c, accepted: true })));
  const header = headerFor(doc);
  const guards: Change[] = [];
  for (const cell of doc.cells) {
    const id = cellUnitId(cell.row, cell.column);
    const list = groups.get(id);
    const finals = list
      ? [
          cell.value,
          applyToUnit(id, cell.value, list),
          applyToUnit(id, cell.value, allGroups.get(id)!),
        ]
      : [cell.value];
    const risky = finals.findIndex(isFormulaRisk);
    if (risky < 0) continue;
    const first = finals[risky]![0]!;
    const h = header(cell.row, cell.column);
    const when =
      risky === 0
        ? `Starts with ${shown(first)}`
        : `Will start with ${shown(first)} once the other changes are applied`;
    guards.push({
      id: `s${guards.length + 1}`,
      stage: 'safety',
      kind: GUARD,
      from: '',
      to: "'",
      reason: `${when}, so a spreadsheet app could run it as a formula; an apostrophe in front makes it plain text`,
      confidence: 'high',
      anchor: { kind: 'original', unit: id, start: 0, end: 0 },
      location: {
        type: 'csv',
        row: cell.row,
        column: cell.column,
        ...(h !== undefined ? { header: h } : {}),
        charPos: 1,
      },
      accepted: true,
    });
  }
  return guards;
}

function needsQuotes(value: string, delimiter: string): boolean {
  return value.includes(delimiter) || /["\r\n]/.test(value);
}

const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;

/** Changes that affect a unit: its top-level changes plus everything nested inside them. */
function groupByUnit(changes: readonly Change[]): Map<string, Change[]> {
  const byParent = new Map<string, Change[]>();
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    if (c.anchor.kind === 'inParent') {
      const l = byParent.get(c.anchor.parentId) ?? [];
      l.push(c);
      byParent.set(c.anchor.parentId, l);
    } else {
      const l = groups.get(c.anchor.unit) ?? [];
      l.push(c);
      groups.set(c.anchor.unit, l);
    }
  }
  const byId = new Map(changes.map((c) => [c.id, c]));
  for (const list of groups.values()) {
    for (let k = 0; k < list.length; k++) {
      for (const child of byParent.get(list[k]!.id) ?? []) list.push(child);
      // Parents in dependsOn (e.g. a translation's Stage 1 parents) are needed to decide
      // whether a change is applied.
      for (const pid of list[k]!.dependsOn ?? []) {
        const p = byId.get(pid);
        if (p && !list.includes(p)) list.push(p);
      }
    }
  }
  return groups;
}

/**
 * Splice writer: rewrites only edited cells, keeping their original quoting. An
 * applied formula guard inserts its apostrophe only if the cell's final value is a
 * formula risk (so rejecting the change that made it one also drops the apostrophe).
 */
export function applyCsv(doc: CsvDoc, changes: readonly Change[]): CsvDoc {
  const edited = editedCells(doc, changes);
  if (edited.length === 0) return doc;
  let out = '';
  let pos = 0;
  for (const e of edited) {
    out += doc.source.slice(pos, e.cell.start) + e.raw;
    pos = e.cell.end;
  }
  out += doc.source.slice(pos);
  return parseCsv(out, { delimiter: doc.delimiter, hasHeader: doc.hasHeader });
}

/** A cell whose value changes, with its new raw text (quoted as the splice writer writes it). */
export interface EditedCell {
  cell: CsvCell;
  value: string;
  raw: string;
  /** Applied changes in this cell (including nested ones). */
  applied: Change[];
}

/** Every cell whose value changes once the applied changes are written, in source order. */
export function editedCells(doc: CsvDoc, changes: readonly Change[]): EditedCell[] {
  const groups = groupByUnit(changes);
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  const out: EditedCell[] = [];
  for (const cell of doc.cells) {
    const id = cellUnitId(cell.row, cell.column);
    const list = groups.get(id);
    if (!list) continue;
    const applied = list.filter((c) => isApplied(c, byId, memo));
    const guarded = applied.some((c) => c.kind === GUARD);
    let value = applyToUnit(
      id,
      cell.value,
      list.filter((c) => c.kind !== GUARD),
    );
    if (guarded && isFormulaRisk(value)) value = `'${value}`;
    if (value === cell.value) continue;
    const raw = cell.quoted || needsQuotes(value, doc.delimiter) ? quote(value) : value;
    out.push({ cell, value, raw, applied });
  }
  return out;
}

/**
 * Source offset of a UTF-16 offset in a cell's unescaped value (skips quotes and `""`
 * escapes). A range `start` lands after a closing quote; a range `end` lands before it.
 */
export function valueOffsetToSource(
  source: string,
  cell: CsvCell,
  offset: number,
  edge: 'start' | 'end' = 'start',
): number {
  if (!cell.quoted) return cell.start + offset;
  let i = cell.start + 1;
  let v = 0;
  let closed = false;
  while (v < offset && i < cell.end) {
    if (!closed && source.charCodeAt(i) === 0x22) {
      if (source.charCodeAt(i + 1) === 0x22) {
        i += 2;
        v++;
      } else {
        i++; // the closing quote is not part of the value
        closed = true;
      }
      continue;
    }
    i++;
    v++;
  }
  const atClosingQuote =
    !closed && i < cell.end && source.charCodeAt(i) === 0x22 && source.charCodeAt(i + 1) !== 0x22;
  return atClosingQuote && edge === 'start' && i + 1 < cell.end ? i + 1 : i;
}
