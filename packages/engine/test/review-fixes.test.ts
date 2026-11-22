/**
 * Fixes asked for in the Phase 1 review (decision log D11):
 * 1. the formula guard checks the FINAL cell value, after every accepted change;
 * 2. ambiguous pairs like `Ä…` are medium confidence and only auto-accepted when
 *    the same file has other high-confidence mojibake repairs;
 * 3. applyChanges reports characters that are still not ASCII when the ASCII stage is on.
 */
import { describe, expect, it } from 'vitest';
import {
  analyze,
  applyChanges,
  checkOutput,
  parseCsv,
  parseText,
  render,
  setDecision,
  setGroupDecision,
  type Change,
  type CsvDoc,
} from '../src/index';
import { mojibake } from './helpers';

const ASCII = { stages: { encoding: true, ascii: true } } as const;
const guardsOf = (changes: Change[]) => changes.filter((c) => c.kind === 'formula-guard');

describe('fix 1: formula guard on the final cell value', () => {
  it('guards full-width ＝SUM, which becomes =SUM after Stage 2', () => {
    const doc = parseCsv('a,b\nx,＝SUM(A1)\n');
    const { changes } = analyze(doc, ASCII);
    const guards = guardsOf(changes);
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({
      stage: 'safety',
      from: '',
      to: "'",
      accepted: true,
      location: { type: 'csv', row: 2, column: 2, header: 'b', charPos: 1 },
    });
    expect(guards[0]!.reason).toContain('=');
    const out = applyChanges(doc, changes, ASCII);
    expect(render(out)).toBe("a,b\nx,'=SUM(A1)\n");
    expect(out.report.formulaRisks).toEqual([]);
  });

  it('guards a cell whose leading invisible character hides the =', () => {
    const doc = parseCsv('a\n​=HYPERLINK("x")\n');
    const { changes } = analyze(doc, ASCII);
    expect(render(applyChanges(doc, changes, ASCII))).toBe('a\n"\'=HYPERLINK(""x"")"\n');
  });

  it('guards a cell where a garbled zero-width space hides the =', () => {
    const doc = parseCsv(`a\n${mojibake('​=cmd')}\n`);
    const { changes } = analyze(doc, ASCII);
    expect(render(applyChanges(doc, changes, ASCII))).toBe("a\n'=cmd\n");
  });

  it('does not add the apostrophe when the change that made it a formula is rejected', () => {
    const doc = parseCsv('a\n＝SUM(A1)\n');
    const changes = analyze(doc, ASCII).changes;
    const fw = changes.find((c) => c.kind === 'fullwidth')!;
    const out = applyChanges(doc, setDecision(changes, fw.id, false), ASCII);
    expect(render(out)).toBe('a\n＝SUM(A1)\n');
    expect(out.report.formulaRisks).toEqual([]);
  });

  it('never guards a value that ends up as a number (＋1.5 → +1.5)', () => {
    const doc = parseCsv('a\n＋1.5\n－42\n');
    const { changes } = analyze(doc, ASCII);
    expect(guardsOf(changes)).toEqual([]);
    expect(render(applyChanges(doc, changes, ASCII))).toBe('a\n+1.5\n-42\n');
  });

  it('reports cells that would still run as formulas when the guard is rejected', () => {
    const doc = parseCsv('a,b\n=1+1,ok\nx,＝2\n');
    const changes = setGroupDecision(
      analyze(doc, ASCII).changes,
      (c) => c.kind === 'formula-guard',
      false,
    );
    const out = applyChanges(doc, changes, ASCII);
    expect(render(out)).toBe('a,b\n=1+1,ok\nx,=2\n');
    expect(out.report.formulaRisks).toEqual([
      { type: 'csv', row: 2, column: 1, header: 'a', charPos: 1 },
      { type: 'csv', row: 3, column: 2, header: 'b', charPos: 1 },
    ]);
  });

  it('reports no formula risks when the guard is switched off', () => {
    const doc = parseCsv('a\n=1+1\n');
    const opts = { safety: { formulaGuard: false } };
    expect(applyChanges(doc, analyze(doc, opts).changes, opts).report.formulaRisks).toEqual([]);
  });

  it('keeps the original-value guard for plain = + - @ cells', () => {
    const doc = parseCsv('a\n@SUM(A1)\n');
    const { changes } = analyze(doc);
    expect(guardsOf(changes).map((g) => g.reason)).toEqual([expect.stringContaining('“@”')]);
    expect(render(applyChanges(doc, changes))).toBe("a\n'@SUM(A1)\n");
  });
});

describe('fix 2: ambiguous Ä… repairs', () => {
  it('is medium confidence and not accepted when nothing else in the file is garbled', () => {
    const { changes } = analyze(parseText('Wörter mit Ä… gibt es viele.'));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      from: 'Ä…',
      to: 'ą',
      confidence: 'medium',
      accepted: false,
    });
    expect(changes[0]!.reason).toMatch(/real “Ä”/);
  });

  it('is accepted when the same file has other high-confidence repairs', () => {
    const text = `${mojibake('Zażółć gęślą jaźń')} i ${mojibake('wiązanie')}`;
    const doc = parseText(text);
    const { changes } = analyze(doc);
    const amb = changes.filter((c) => c.from === 'Ä…');
    expect(amb.length).toBeGreaterThan(0);
    for (const c of amb) expect(c).toMatchObject({ confidence: 'medium', accepted: true });
    expect(changes.some((c) => c.confidence === 'high')).toBe(true);
    expect(render(applyChanges(doc, changes))).toBe('Zażółć gęślą jaźń i wiązanie');
  });

  it('counts repairs in other CSV cells of the same file', () => {
    const doc = parseCsv(`a,b\n${mojibake('Café')},Ä…\n`);
    const amb = analyze(doc).changes.find((c) => c.from === 'Ä…');
    expect(amb).toMatchObject({ confidence: 'medium', accepted: true });
  });

  it('also covers Å followed by punctuation (Å… could be a real Scandinavian Å)', () => {
    const { changes } = analyze(parseText('PÅ…'));
    expect(changes[0]).toMatchObject({ confidence: 'medium', accepted: false });
  });
});

describe('fix 3: characters still not ASCII after applying', () => {
  it('lists remaining non-ASCII characters with their locations in the output (text)', () => {
    const doc = parseText('Hi 😀\nMосква');
    const changes = analyze(doc, ASCII).changes;
    const { report } = applyChanges(doc, changes, ASCII);
    expect(report.nonAscii.map((n) => n.char)).toEqual(['😀', 'о', 'с', 'к', 'в', 'а']);
    expect(report.nonAscii[0]!.location).toEqual({ type: 'text', line: 1, column: 4, offset: 3 });
    expect(report.nonAscii[1]!.location).toEqual({ type: 'text', line: 2, column: 2, offset: 7 });
    expect(report.nonAscii[0]!.codePoint).toBe(0x1f600);
  });

  it('includes characters left by a rejected Stage 1 repair', () => {
    const doc = parseText('CafÃ© ok');
    const changes = analyze(doc, ASCII).changes;
    const e = changes.find((c) => c.stage === 'encoding')!;
    const { report } = applyChanges(doc, setDecision(changes, e.id, false), ASCII);
    expect(report.nonAscii.map((n) => n.char)).toEqual(['Ã', '©']);
  });

  it('includes characters whose Stage 2 change was rejected inside an accepted repair', () => {
    const doc = parseText('CafÃ©');
    const changes = analyze(doc, ASCII).changes;
    const accent = changes.find((c) => c.stage === 'ascii')!;
    const out = applyChanges(doc, setDecision(changes, accent.id, false), ASCII);
    expect(render(out)).toBe('Café');
    expect(out.report.nonAscii).toEqual([
      { char: 'é', codePoint: 0xe9, location: { type: 'text', line: 1, column: 4, offset: 3 } },
    ]);
  });

  it('is empty when everything became ASCII, and when the ASCII stage is off', () => {
    const doc = parseText('Café “ok”');
    expect(applyChanges(doc, analyze(doc, ASCII).changes, ASCII).report.nonAscii).toEqual([]);
    expect(applyChanges(doc, analyze(doc).changes).report.nonAscii).toEqual([]);
  });

  it('locates remaining characters by row, column and header in CSV', () => {
    const doc = parseCsv('name,city\nAna,"Москва, RU"\n');
    const out = applyChanges(doc, analyze(doc, ASCII).changes, ASCII);
    expect(out.report.nonAscii).toHaveLength(6);
    expect(out.report.nonAscii[0]).toEqual({
      char: 'М',
      codePoint: 0x41c,
      location: { type: 'csv', row: 2, column: 2, header: 'city', charPos: 1 },
    });
  });

  it('checkOutput reports on any document, e.g. before any change', () => {
    const doc = parseCsv('a\n=1\nñ\n');
    expect(checkOutput(doc, ASCII)).toEqual({
      nonAscii: [
        {
          char: 'ñ',
          codePoint: 0xf1,
          location: { type: 'csv', row: 3, column: 1, header: 'a', charPos: 1 },
        },
      ],
      formulaRisks: [{ type: 'csv', row: 2, column: 1, header: 'a', charPos: 1 }],
    });
  });

  it('the applied CSV doc is still a normal CsvDoc', () => {
    const doc = parseCsv('a\nCafé\n');
    const out = applyChanges(doc, analyze(doc, ASCII).changes, ASCII) as CsvDoc & {
      report: unknown;
    };
    expect(out.format).toBe('csv');
    expect(render(out)).toBe('a\nCafe\n');
  });
});
