import { analyze, parseCsv, parseText, preview, render, type Doc } from '@cleanify/engine';
import { describe, expect, it } from 'vitest';
import { buildRows, rowAtOffset, rowAtOutLine, type Seg } from '../src/lib/rows';

const ASCII = { stages: { encoding: true, ascii: true } } as const;
const text = (segs: Seg[]) => segs.map((s) => s.text).join('');

function rowsFor(doc: Doc) {
  const p = preview(doc, analyze(doc, ASCII).changes);
  return buildRows(render(doc), p.marks, p.edits);
}

describe('buildRows', () => {
  it('makes one row per line, with highlights on both sides', () => {
    const rows = rowsFor(parseText('Café ok\nplain\r\n“x”\n'));
    expect(rows.map((r) => [text(r.before), text(r.after)])).toEqual([
      ['Café ok', 'Cafe ok'],
      ['plain', 'plain'],
      ['“x”', '"x"'],
    ]);
    expect(rows[0]!.before).toEqual([
      { kind: 'plain', text: 'Caf' },
      expect.objectContaining({ kind: 'mark', text: 'é', stage: 'ascii', applied: true }),
      { kind: 'plain', text: ' ok' },
    ]);
    expect(rows[0]!.after[1]).toMatchObject({ kind: 'edit', text: 'e', stage: 'ascii' });
    expect(rows.map((r) => [r.line, r.outLine])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('keeps an empty last line out and handles empty text', () => {
    expect(rowsFor(parseText(''))).toHaveLength(1);
    expect(rowsFor(parseText('a\n'))).toHaveLength(1);
  });

  it('merges lines when a change spans a line break (CSV cell with a newline)', () => {
    const doc = parseCsv('a,b\n"x\ny Café",z\nlast,1\n');
    const rows = rowsFor(doc);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
    expect(text(rows[1]!.after)).toBe('"x\ny Cafe",z');
    expect(rows[2]!.outLine).toBe(4);
  });

  it('shows a removed character as an empty edit and an insertion as an empty mark', () => {
    const rows = rowsFor(parseCsv('a\n=1+1​\n'));
    const r = rows[1]!;
    expect(r.before.some((s) => s.kind === 'mark' && s.text === '' && s.stage === 'safety')).toBe(
      true,
    );
    expect(text(r.after)).toBe("'=1+1");
  });

  it('finds rows by original offset and output line', () => {
    const rows = rowsFor(parseText('one\ntwo\nthree'));
    expect(rowAtOffset(rows, 0)).toBe(0);
    expect(rowAtOffset(rows, 5)).toBe(1);
    expect(rowAtOffset(rows, 999)).toBe(2);
    expect(rowAtOutLine(rows, 3)).toBe(2);
  });
});
