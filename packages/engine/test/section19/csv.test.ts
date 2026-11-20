/**
 * Section 19 — CSV bugs #1, #2, #15, #17.
 */
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  applyChanges,
  decode,
  parseCsv,
  parseText,
  render,
  serialize,
  type Change,
  type CsvDoc,
} from '../../src/index';
import { CSV_FIXTURES } from '../fixtures/csv';
import { bytes, utf8 } from '../helpers';

const values = (doc: CsvDoc): string[][] => {
  const rows: string[][] = [];
  for (const c of doc.cells) (rows[c.row - 1] ??= [])[c.column - 1] = c.value;
  return rows;
};

describe('#1 quoted CSV fields are never corrupted', () => {
  it('parses "Smith, John" as one value', () => {
    const doc = parseCsv('name,city\n"Smith, John",Paris\n');
    expect(values(doc)).toEqual([
      ['name', 'city'],
      ['Smith, John', 'Paris'],
    ]);
  });

  it.each(CSV_FIXTURES)('round-trips byte-identically with no changes: $name', (f) => {
    const input = utf8(f.source);
    const decoded = decode(input);
    const doc = parseCsv(decoded.text);
    const out = serialize(applyChanges(doc, []), {
      encoding: decoded.encoding,
      bomCount: decoded.bomCount,
    });
    expect(Buffer.from(out).equals(Buffer.from(input))).toBe(true);
  });

  it('round-trips byte-identically with a BOM', () => {
    const input = bytes([0xef, 0xbb, 0xbf], 'a,b\n"x, y",2\n');
    const d = decode(input);
    const out = serialize(parseCsv(d.text), { encoding: d.encoding, bomCount: d.bomCount });
    expect(Buffer.from(out).equals(Buffer.from(input))).toBe(true);
  });

  it.each(CSV_FIXTURES)('cell values match Papa Parse (oracle): $name', (f) => {
    const doc = parseCsv(f.source, f.delimiter ? { delimiter: f.delimiter } : {});
    const oracle = Papa.parse<string[]>(f.source, {
      delimiter: f.delimiter ?? ',',
      skipEmptyLines: false,
    }).data;
    // Papa reports a trailing newline as one extra empty row; we don't.
    const last = oracle.at(-1);
    if (last && last.length === 1 && last[0] === '') oracle.pop();
    expect(values(doc)).toEqual(oracle);
  });

  it('an edited quoted cell keeps its quotes', () => {
    const doc = parseCsv('name\n"Café, Paris"\n');
    const { changes } = analyze(doc, { stages: { encoding: true, ascii: true } });
    expect(render(applyChanges(doc, changes))).toBe('name\n"Cafe, Paris"\n');
  });

  it('an unquoted cell stays unquoted unless the new value needs quotes', () => {
    const doc = parseCsv('a,b\nCafé,x\n');
    const { changes } = analyze(doc, { stages: { encoding: true, ascii: true } });
    expect(render(applyChanges(doc, changes))).toBe('a,b\nCafe,x\n');

    const cell = doc.cells.find((c) => c.value === 'x')!;
    const manual: Change = {
      id: 'm1',
      stage: 'ascii',
      kind: 'test',
      from: 'x',
      to: 'x, "y"',
      reason: 'test',
      confidence: 'high',
      anchor: { kind: 'original', unit: `r${cell.row}c${cell.column}`, start: 0, end: 1 },
      location: { type: 'csv', row: cell.row, column: cell.column, charPos: 1 },
      accepted: true,
    };
    expect(render(applyChanges(doc, [manual]))).toBe('a,b\nCafé,"x, ""y"""\n');
  });
});

describe('#2 the last CSV row is never duplicated', () => {
  it.each(CSV_FIXTURES)('$name has $rows rows', (f) => {
    const doc = parseCsv(f.source, f.delimiter ? { delimiter: f.delimiter } : {});
    expect(doc.rowCount).toBe(f.rows);
    expect(Math.max(...doc.cells.map((c) => c.row))).toBe(f.rows);
  });
});

describe('#15 columns are 1-based and counted in code points', () => {
  it('reports the right CSV column and character position after an emoji', () => {
    const doc = parseCsv('id,x,text\n1,y,😀 Café\n');
    const { changes } = analyze(doc, { stages: { encoding: true, ascii: true } });
    const accent = changes.find((c) => c.from === 'é');
    expect(accent?.location).toEqual({
      type: 'csv',
      row: 2,
      column: 3,
      header: 'text',
      charPos: 6,
    });
  });

  it('reports the right text column after an emoji', () => {
    const { changes } = analyze(parseText('ok\n😀 Café'), {
      stages: { encoding: true, ascii: true },
    });
    const accent = changes.find((c) => c.from === 'é');
    expect(accent?.location).toMatchObject({ type: 'text', line: 2, column: 6 });
  });
});

describe('#17 an unterminated quote is reported, not swallowed', () => {
  const source = 'a,b\n1,2\n3,"oops\n4,5\n';

  it('warns with the line number where the quote opened', () => {
    const doc = parseCsv(source);
    expect(doc.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'unterminated-quote',
        location: expect.objectContaining({ row: 3 }),
      }),
    );
    expect(doc.warnings[0]?.message).toMatch(/line 3/);
  });

  it('keeps the rows before it and still round-trips the bytes', () => {
    const doc = parseCsv(source);
    expect(values(doc).slice(0, 2)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(render(applyChanges(doc, []))).toBe(source);
  });
});
