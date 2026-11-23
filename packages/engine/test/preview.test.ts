/**
 * preview(): marks and edits in original-document offsets, for the before/after view.
 */
import { describe, expect, it } from 'vitest';
import {
  analyze,
  applyChanges,
  parseCsv,
  parseText,
  preview,
  render,
  setDecision,
  type Doc,
  type Preview,
} from '../src/index';
import { valueOffsetToSource } from '../src/formats/csv';

const ASCII = { stages: { encoding: true, ascii: true } } as const;

/** Rebuilds the output from the original and the edits. */
function spliced(doc: Doc, p: Preview): string {
  const src = render(doc);
  let out = '';
  let pos = 0;
  for (const e of p.edits) {
    out += src.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + src.slice(pos);
}

describe('preview', () => {
  it('text: marks every top-level change, edits rebuild the output', () => {
    const doc = parseText('CafÃ© “x”​');
    const changes = analyze(doc, ASCII).changes;
    const p = preview(doc, changes);
    expect(p.marks.map((m) => [m.start, m.end, m.stage])).toEqual([
      [3, 5, 'encoding'],
      [6, 7, 'ascii'],
      [8, 9, 'ascii'],
      [9, 10, 'invisible'],
    ]);
    expect(p.edits[0]).toMatchObject({ start: 3, end: 5, text: 'e', stage: 'encoding' });
    expect(p.edits[0]!.ids).toHaveLength(2); // the repair and its nested accent change
    expect(spliced(doc, p)).toBe(render(applyChanges(doc, changes)));
  });

  it('text: a rejected change is marked but not edited', () => {
    const doc = parseText('a b');
    const changes = analyze(doc, ASCII).changes;
    const p = preview(doc, setDecision(changes, changes[0]!.id, false));
    expect(p.marks).toEqual([
      { start: 1, end: 2, id: changes[0]!.id, stage: 'invisible', applied: false },
    ]);
    expect(p.edits).toEqual([]);
  });

  it('csv: marks map value offsets to source offsets across quotes and "" escapes', () => {
    const doc = parseCsv('a,b\n"say ""hi"" Café",=1+1\n');
    const changes = analyze(doc, ASCII).changes;
    const p = preview(doc, changes);
    const src = render(doc);
    const accent = p.marks.find((m) => m.stage === 'ascii')!;
    expect(src.slice(accent.start, accent.end)).toBe('é');
    const guard = p.marks.find((m) => m.stage === 'safety')!;
    expect(guard.start).toBe(guard.end);
    expect(src.slice(guard.start, guard.start + 4)).toBe('=1+1');
    expect(p.edits.map((e) => e.stage)).toEqual(['ascii', 'safety']);
    expect(spliced(doc, p)).toBe(render(applyChanges(doc, changes)));
  });

  it('csv: no applied changes means no edits', () => {
    const doc = parseCsv('a\nCafé\n');
    expect(preview(doc, []).edits).toEqual([]);
  });

  it('valueOffsetToSource handles unquoted cells, escapes and the value end', () => {
    const src = 'x,"a""b"z\n';
    const doc = parseCsv(src);
    const [plain, quoted] = doc.cells;
    expect(valueOffsetToSource(src, plain!, 1)).toBe(1);
    expect(quoted!.value).toBe('a"bz');
    expect(valueOffsetToSource(src, quoted!, 0)).toBe(3);
    expect(valueOffsetToSource(src, quoted!, 2)).toBe(6);
    expect(valueOffsetToSource(src, quoted!, 3)).toBe(8); // after the closing quote: "z"
    expect(valueOffsetToSource(src, quoted!, 4)).toBe(9);
  });
});

describe('analyze progress', () => {
  it('reports done/total per unit and finishes at total', () => {
    const calls: [number, number][] = [];
    analyze(parseCsv('a,b\n1,2\n'), {}, { onProgress: (d, t) => calls.push([d, t]) });
    expect(calls).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });
});
