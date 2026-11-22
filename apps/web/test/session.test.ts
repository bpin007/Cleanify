import { describe, expect, it } from 'vitest';
import type { CleanSettings } from '../src/engine/protocol';
import { EngineSession, lineIndex } from '../src/engine/session';

const settings = (over: Partial<CleanSettings> = {}): CleanSettings => ({
  repair: true,
  ascii: false,
  asciiOptions: { emoji: 'keep', nonLatin: 'keep' },
  ...over,
});
const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const CP: Record<string, number> = { '“': 0x93, '”': 0x94 };
const cp1252 = (s: string) =>
  Uint8Array.from([...s].map((c) => CP[c] ?? c.charCodeAt(0))).buffer as ArrayBuffer;
const noop = () => {};

describe('EngineSession', () => {
  it('analyzes pasted text and reports progress up to 1', async () => {
    const s = new EngineSession();
    const fractions: number[] = [];
    const data = await s.analyze({ kind: 'paste', text: 'CafÃ© ok' }, settings(), (_p, f) =>
      fractions.push(f),
    );
    expect(data.source).toMatchObject({ name: 'Pasted text', format: 'text', encoding: null });
    expect(data.changes).toHaveLength(1);
    expect(data.applied).toEqual([true]);
    expect(fractions.at(-1)).toBe(1);
    expect(s.outputText()).toBe('Café ok');
    expect(data.suggestedEncoding).toBe('utf-8');
  });

  it('records decisions, greys out dependents and reports non-ASCII leftovers', async () => {
    const s = new EngineSession();
    const data = await s.analyze({ kind: 'paste', text: 'CafÃ©' }, settings({ ascii: true }), noop);
    const parent = data.changes.find((c) => c.stage === 'encoding')!;
    const v = s.decide([{ type: 'one', id: parent.id, accepted: false }]);
    expect(v.applied).toEqual([false, false]);
    expect(v.acceptable).toEqual([true, false]);
    expect(v.nonAscii.map((n) => [n.char, n.outLine])).toEqual([
      ['Ã', 1],
      ['©', 1],
    ]);
    const all = s.decide([{ type: 'group', stage: 'encoding', accepted: true }]);
    expect(all.applied).toEqual([true, true]);
    expect(s.outputText()).toBe('Cafe');
  });

  it('reads a CSV file, gives formula risks an output line, and serializes', async () => {
    const s = new EngineSession();
    const src = 'a;b\n"x\ny";=1+1\n';
    const data = await s.analyze(
      { kind: 'file', name: 'a.csv', format: 'csv', bytes: utf8(src) },
      settings(),
      noop,
    );
    expect(data.source).toMatchObject({ encoding: 'utf-8', delimiter: ';', bytes: src.length });
    const v = s.decide([{ type: 'group', stage: 'safety', accepted: false }]);
    expect(v.formulaRisks.map((r) => r.outLine)).toEqual([3]);
    const out = s.serialize('utf-8', 0);
    expect(out.ok && new TextDecoder().decode(out.bytes)).toBe(src);
  });

  it('blocks a save that would lose characters and says where they are', async () => {
    const s = new EngineSession();
    await s.analyze({ kind: 'paste', text: 'ok\nab€ 中' }, settings(), noop);
    expect(s.serialize('windows-1252', 0)).toEqual({
      ok: false,
      chars: [{ char: '中', line: 2, column: 5 }],
    });
  });

  it('re-reads a file with an encoding the user picked', async () => {
    const s = new EngineSession();
    const bytes = cp1252('“quoted”');
    const first = await s.analyze(
      { kind: 'file', name: 'q.txt', format: 'text', bytes },
      settings(),
      noop,
    );
    expect(first.source.encoding).toBe('windows-1252');
    expect(first.original).toBe('“quoted”');
    const again = await s.reanalyze('utf-8', settings(), noop);
    expect(again.source).toMatchObject({ encoding: 'utf-8', encodingReason: 'Chosen by you' });
    expect(again.original).toContain('�');
  });

  it('refuses to re-read pasted text with another encoding', async () => {
    const s = new EngineSession();
    await s.analyze({ kind: 'paste', text: 'x' }, settings(), noop);
    await expect(s.reanalyze('utf-8', settings(), noop)).rejects.toThrow(/Only files/);
  });

  it('loads the transliterator when asked', async () => {
    const s = new EngineSession();
    await s.analyze(
      { kind: 'paste', text: 'Москва' },
      settings({ ascii: true, asciiOptions: { nonLatin: 'transliterate' } }),
      noop,
    );
    expect(s.outputText()).toBe('Moskva');
  });
});

describe('lineIndex', () => {
  it('maps offsets to 1-based lines', () => {
    const line = lineIndex('a\nbc\n\nd');
    expect([0, 1, 2, 4, 5, 6].map(line)).toEqual([1, 1, 2, 2, 3, 4]);
  });
});
