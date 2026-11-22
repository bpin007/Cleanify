/**
 * CSV adapter beyond section 19: formula guard (D8), delimiter detection, legacy
 * encodings, and property tests on random CSVs.
 */
import fc from 'fast-check';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  appliedIds,
  applyChanges,
  decode,
  detectDelimiter,
  encodeText,
  parseCsv,
  render,
  serialize,
  setGroupDecision,
  suggestOutputEncoding,
  type Change,
  type CsvDoc,
} from '../src/index';

const values = (doc: CsvDoc): string[][] => {
  const rows: string[][] = [];
  for (const c of doc.cells) (rows[c.row - 1] ??= [])[c.column - 1] = c.value;
  return rows;
};

describe('formula-injection guard (section 17, decision D8)', () => {
  const source =
    'name,total,note\nAlice,-42,=HYPERLINK("http://x")\nBob,+1.5,@SUM(A1)\nCara,-1,234.5,-ok\n';

  it('proposes a visible safety change for text cells only', () => {
    const doc = parseCsv(source);
    const guards = analyze(doc).changes.filter((c) => c.kind === 'formula-guard');
    expect(guards.map((g) => [g.stage, g.from, g.to, g.accepted])).toEqual([
      ['safety', '=', "'=", true],
      ['safety', '@', "'@", true],
      ['safety', '-', "'-", true],
    ]);
    expect(guards.map((g) => g.location)).toEqual([
      { type: 'csv', row: 2, column: 3, header: 'note', charPos: 1 },
      { type: 'csv', row: 3, column: 3, header: 'note', charPos: 1 },
      { type: 'csv', row: 4, column: 4, charPos: 1 },
    ]);
  });

  it('never touches real numbers like -42, +1.5, -1', () => {
    const doc = parseCsv('a\n-42\n+1.5\n-1\n-1,5\n1e5\n-.5\n12%\n-\n');
    expect(analyze(doc).changes).toEqual([]);
  });

  it('applies the guard, adding the quotes an edited cell needs', () => {
    // The input cell holds quotes without being quoted (malformed but common). Once it
    // is edited, the plan's rule applies: a value containing a quote gets quotes.
    const doc = parseCsv(source);
    const out = render(applyChanges(doc, analyze(doc).changes));
    expect(out).toBe(
      'name,total,note\nAlice,-42,"\'=HYPERLINK(""http://x"")"\nBob,+1.5,\'@SUM(A1)\nCara,-1,234.5,\'-ok\n',
    );
    expect(values(parseCsv(out))[1]).toEqual(['Alice', '-42', '\'=HYPERLINK("http://x")']);
  });

  it('with every change rejected the output is byte-identical', () => {
    const doc = parseCsv(source);
    const none = setGroupDecision(analyze(doc).changes, () => true, false);
    expect(render(applyChanges(doc, none))).toBe(source);
  });

  it('can be switched off', () => {
    const doc = parseCsv(source);
    expect(analyze(doc, { safety: { formulaGuard: false } }).changes).toEqual([]);
  });
});

describe('delimiters, headers, warnings', () => {
  it.each([
    ['a,b,c\n1,2,3\n', ','],
    ['a;b;c\n1;2;3\n', ';'],
    ['a\tb\tc\n1\t2\t3\n', '\t'],
    ['a|b|c\n1|2|3\n', '|'],
    ['', ','],
  ])('detects the delimiter in %j', (src, d) => {
    expect(detectDelimiter(src)).toBe(d);
  });

  it('omits the header for row 1 and when hasHeader is false', () => {
    const doc = parseCsv('Café,b\nCafé,x\n');
    const locs = analyze(doc, { stages: { ascii: true } }).changes.map((c) => c.location);
    expect(locs).toEqual([
      { type: 'csv', row: 1, column: 1, charPos: 4 },
      { type: 'csv', row: 2, column: 1, header: 'Café', charPos: 4 },
    ]);
    const noHeader = parseCsv('Café,b\nCafé,x\n', { hasHeader: false });
    expect(analyze(noHeader, { stages: { ascii: true } }).changes[1]?.location).not.toHaveProperty(
      'header',
    );
  });

  it('passes the tokenizer warnings through analyze', () => {
    const { warnings } = analyze(parseCsv('a\n"open\n'));
    expect(warnings.map((w) => w.kind)).toContain('unterminated-quote');
  });

  it('repairs mojibake inside quoted cells and keeps the quotes', () => {
    const doc = parseCsv('name\n"GarcÃ­a, JosÃ©"\n');
    expect(render(applyChanges(doc, analyze(doc).changes))).toBe('name\n"García, José"\n');
  });

  it('handles an empty file', () => {
    const doc = parseCsv('');
    expect(doc).toMatchObject({ rowCount: 0, cells: [] });
    expect(render(applyChanges(doc, analyze(doc).changes))).toBe('');
  });
});

describe('legacy encodings', () => {
  it('round-trips a Windows-1252 CSV byte for byte', () => {
    const input = encodeText('name;city\r\n"Müller, “Hans”";Köln\r\n', 'windows-1252');
    const d = decode(input);
    expect(d.encoding).toBe('windows-1252');
    const doc = parseCsv(d.text);
    expect(doc.delimiter).toBe(';');
    const out = serialize(applyChanges(doc, []), { encoding: d.encoding, bomCount: d.bomCount });
    expect(Buffer.from(out).equals(Buffer.from(input))).toBe(true);
  });

  it('suggests UTF-8 output only when Stage 1 repairs are applied (D1)', () => {
    const repaired = parseCsv('a\nCafÃ©\n');
    const changes = analyze(repaired).changes;
    expect(suggestOutputEncoding('windows-1252', changes)).toBe('utf-8');
    expect(suggestOutputEncoding('windows-1252', [])).toBe('windows-1252');
  });
});

// ── Property tests on random CSVs ───────────────────────────────────────────

const cellText = fc
  .array(fc.constantFrom(...'ab Z9,;"\n\r\t', 'é', 'Ã©', '“', '😀', ' ', '=', '-'), {
    maxLength: 8,
  })
  .map((a) => a.join(''));

interface CsvSpec {
  rows: { value: string; forceQuote: boolean }[][];
  eol: '\n' | '\r\n';
  trailing: boolean;
  delimiter: ',' | ';' | '\t';
}

const csvSpec: fc.Arbitrary<CsvSpec> = fc.record({
  rows: fc.array(
    fc.array(fc.record({ value: cellText, forceQuote: fc.boolean() }), {
      minLength: 1,
      maxLength: 4,
    }),
    {
      minLength: 1,
      maxLength: 6,
    },
  ),
  eol: fc.constantFrom('\n' as const, '\r\n' as const),
  trailing: fc.boolean(),
  delimiter: fc.constantFrom(',' as const, ';' as const, '\t' as const),
});

function build(spec: CsvSpec): string {
  const field = ({ value, forceQuote }: { value: string; forceQuote: boolean }) => {
    const needs = value.includes(spec.delimiter) || /["\r\n]/.test(value) || value === '';
    return forceQuote || needs ? `"${value.replaceAll('"', '""')}"` : value;
  };
  return (
    spec.rows.map((r) => r.map(field).join(spec.delimiter)).join(spec.eol) +
    (spec.trailing ? spec.eol : '')
  );
}

describe('CSV properties (fast-check)', () => {
  it('parse → splice-serialize with no changes is byte-identical', () => {
    fc.assert(
      fc.property(csvSpec, (spec) => {
        const src = build(spec);
        return render(applyChanges(parseCsv(src, { delimiter: spec.delimiter }), [])) === src;
      }),
      { numRuns: 500 },
    );
  });

  it('cell values match Papa Parse and the input spec', () => {
    fc.assert(
      fc.property(csvSpec, (spec) => {
        const src = build(spec);
        const ours = values(parseCsv(src, { delimiter: spec.delimiter }));
        const papa = Papa.parse<string[]>(src, { delimiter: spec.delimiter }).data;
        const last = papa.at(-1);
        if (spec.trailing && last && last.length === 1 && last[0] === '') papa.pop();
        expect(ours).toEqual(papa);
        expect(ours).toEqual(spec.rows.map((r) => r.map((c) => c.value)));
      }),
      { numRuns: 500 },
    );
  });

  it('after applying every change, the file re-parses to exactly the edited values', () => {
    fc.assert(
      fc.property(csvSpec, (spec) => {
        const src = build(spec);
        const doc = parseCsv(src, { delimiter: spec.delimiter });
        const changes: Change[] = analyze(doc, { stages: { encoding: true, ascii: true } }).changes;
        const applied = appliedIds(changes);
        const out = applyChanges(doc, changes) as CsvDoc;
        expect(out.rowCount).toBe(doc.rowCount);
        expect(out.cells.length).toBe(doc.cells.length);
        // Cells without applied changes are byte-for-byte the same slice of the source.
        const touched = new Set(
          changes
            .filter((c) => applied.has(c.id) && c.anchor.kind === 'original')
            .map((c) => (c.anchor as { unit: string }).unit),
        );
        for (const [k, cell] of doc.cells.entries()) {
          if (touched.has(`r${cell.row}c${cell.column}`)) continue;
          const o = out.cells[k]!;
          expect(out.source.slice(o.start, o.end)).toBe(src.slice(cell.start, cell.end));
        }
      }),
      { numRuns: 300 },
    );
  });
});
