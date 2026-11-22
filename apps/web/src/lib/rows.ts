/**
 * Builds the rows of the before/after view from the original text and the engine's
 * preview (marks and edits, both in original offsets). One row per original line;
 * lines are merged when a change spans a line break, so both sides stay aligned.
 */
import type { PreviewEdit, PreviewMark, Stage } from '@cleanify/engine';

export type Seg =
  | { kind: 'plain'; text: string }
  | { kind: 'mark'; text: string; id: string; stage: Stage; applied: boolean }
  | { kind: 'edit'; text: string; ids: string[]; stage: Stage };

export interface Row {
  /** 1-based first original line of the row. */
  line: number;
  /** 1-based first output line of the row. */
  outLine: number;
  /** Offsets of the row in the original. */
  start: number;
  end: number;
  before: Seg[];
  after: Seg[];
}

const stripEol = (segs: Seg[]): Seg[] => {
  const last = segs.at(-1);
  if (!last || last.kind !== 'plain') return segs;
  const text = last.text.replace(/\r?\n$|\r$/, '');
  if (text === last.text) return segs;
  return text === '' ? segs.slice(0, -1) : [...segs.slice(0, -1), { ...last, text }];
};

const countNewlines = (s: string) => {
  let n = 0;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
};

export function buildRows(
  original: string,
  marks: readonly PreviewMark[],
  edits: readonly PreviewEdit[],
): Row[] {
  // Line starts, minus any that fall strictly inside a change.
  const breaks: number[] = [];
  for (let i = original.indexOf('\n'); i >= 0; i = original.indexOf('\n', i + 1)) {
    if (i + 1 < original.length) breaks.push(i + 1);
  }
  const removed = new Uint8Array(breaks.length);
  for (const r of [...marks, ...edits]) {
    if (r.end - r.start < 2) continue;
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid]! <= r.start) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < breaks.length && breaks[k]! < r.end; k++) removed[k] = 1;
  }
  const starts = [0, ...breaks.filter((_, k) => !removed[k])];

  const rows: Row[] = [];
  let mi = 0;
  let ei = 0;
  let outLine = 1;
  let line = 1;
  for (let r = 0; r < starts.length; r++) {
    const start = starts[r]!;
    const end = r + 1 < starts.length ? starts[r + 1]! : original.length;

    const before: Seg[] = [];
    let pos = start;
    while (mi < marks.length && marks[mi]!.start < end) {
      const m = marks[mi]!;
      if (m.start > pos) before.push({ kind: 'plain', text: original.slice(pos, m.start) });
      const from = Math.max(m.start, pos);
      before.push({
        kind: 'mark',
        text: original.slice(from, m.end),
        id: m.id,
        stage: m.stage,
        applied: m.applied,
      });
      pos = Math.max(pos, m.end);
      mi++;
    }
    if (pos < end) before.push({ kind: 'plain', text: original.slice(pos, end) });

    const after: Seg[] = [];
    let outText = '';
    pos = start;
    while (ei < edits.length && edits[ei]!.start < end) {
      const e = edits[ei]!;
      if (e.start > pos) {
        const t = original.slice(pos, e.start);
        after.push({ kind: 'plain', text: t });
        outText += t;
      }
      after.push({ kind: 'edit', text: e.text, ids: e.ids, stage: e.stage });
      outText += e.text;
      pos = Math.max(pos, e.end);
      ei++;
    }
    if (pos < end) {
      const t = original.slice(pos, end);
      after.push({ kind: 'plain', text: t });
      outText += t;
    }

    rows.push({
      line,
      outLine,
      start,
      end,
      before: stripEol(before),
      after: stripEol(after),
    });
    line += countNewlines(original.slice(start, end));
    outLine += countNewlines(outText);
  }
  return rows;
}

/** Index of the row containing an original offset. */
export function rowAtOffset(rows: readonly Row[], offset: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid]!.start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Index of the row containing a 1-based output line. */
export function rowAtOutLine(rows: readonly Row[], outLine: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid]!.outLine <= outLine) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
