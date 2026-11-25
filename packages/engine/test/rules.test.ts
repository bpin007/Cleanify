/**
 * Custom rules (PROJECT.md section 5): run order Stage 1 → Stage 3 → rules → Stage 2.
 * Replace rules become changes (stage 'rule', reason = rule name) that can be rejected;
 * keep rules stop Stage 2 from touching the text they name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  applyChanges,
  parseCsv,
  parseText,
  readWorkbook,
  render,
  setDecision,
  validateChanges,
  type Change,
  type PipelineOptions,
  type SheetDoc,
} from '../src/index';
import { byStage, mojibake } from './helpers';

const ASCII: PipelineOptions = { stages: { encoding: true, ascii: true } };

function run(text: string, options: PipelineOptions) {
  const doc = parseText(text);
  const { changes } = analyze(doc, options);
  validateChanges(changes, () => text);
  const out = (cs: Change[] = changes) => render(applyChanges(doc, cs, options));
  return { doc, changes, out };
}

const replace = (name: string, from: string, to: string) => ({ name, from, to });
const reject = (changes: Change[], id: string) => setDecision(changes, id, false);

describe('replace rules and Stage 2', () => {
  it('a rule wins over Stage 2 for the same text (™ → TM, not ™ → (TM))', () => {
    const r = run('Acme™ Corp', { ...ASCII, rules: { replace: [replace('TM plain', '™', 'TM')] } });
    expect(r.out()).toBe('AcmeTM Corp');
    const [rule] = byStage(r.changes, 'rule');
    expect(rule).toMatchObject({
      stage: 'rule',
      kind: 'replace',
      from: '™',
      to: 'TM',
      reason: 'TM plain',
      accepted: true,
      location: { type: 'text', line: 1, column: 5 },
    });
  });

  it('rejecting the rule falls back to what Stage 2 would do', () => {
    const r = run('Acme™ Corp', { ...ASCII, rules: { replace: [replace('TM plain', '™', 'TM')] } });
    const rule = byStage(r.changes, 'rule')[0]!;
    expect(r.out(reject(r.changes, rule.id))).toBe('Acme(TM) Corp');
  });

  it('Stage 2 never changes what a rule wrote', () => {
    const r = run('x', { ...ASCII, rules: { replace: [replace('accent', 'x', 'é')] } });
    expect(r.out()).toBe('é');
  });

  it('with Stage 2 off, rules still apply', () => {
    const r = run('Acme™', { rules: { replace: [replace('TM plain', '™', 'TM')] } });
    expect(r.out()).toBe('AcmeTM');
  });

  it('matching is exact and case-sensitive, and an empty "from" is ignored', () => {
    const r = run('Cafe cafe CAFE', {
      rules: { replace: [replace('lower', 'cafe', 'coffee'), replace('empty', '', 'x')] },
    });
    expect(r.out()).toBe('Cafe coffee CAFE');
    expect(byStage(r.changes, 'rule')).toHaveLength(1);
  });

  it('a rule can remove text (to = "")', () => {
    const r = run('a [draft] b', { rules: { replace: [replace('no drafts', ' [draft]', '')] } });
    expect(r.out()).toBe('a b');
  });
});

describe('rules on Stage 1 repairs', () => {
  it('inside one repair: anchored in the repair, depends on it', () => {
    const r = run(`Acme${mojibake('™')}`, {
      ...ASCII,
      rules: { replace: [replace('TM plain', '™', 'TM')] },
    });
    expect(r.out()).toBe('AcmeTM');
    const repair = byStage(r.changes, 'encoding')[0]!;
    const rule = byStage(r.changes, 'rule')[0]!;
    expect(rule.anchor).toEqual({
      kind: 'inParent',
      parentId: repair.id,
      offsetInParent: 0,
      length: 1,
    });
    expect(rule.dependsOn).toEqual([repair.id]);
    // Rejecting the repair takes the rule with it: the garbled text stays.
    expect(r.out(reject(r.changes, repair.id))).toBe(`Acme${mojibake('™')}`);
  });

  it('across a repair and plain text: one change over both, depending on the repair', () => {
    const garbled = mojibake('Café'); // "CafÃ©": "Caf" is fine, "Ã©" is the repair
    const r = run(`${garbled} au lait`, {
      ...ASCII,
      rules: { replace: [replace('Coffee', 'Café', 'Coffee')] },
    });
    expect(r.out()).toBe('Coffee au lait');
    const repair = byStage(r.changes, 'encoding')[0]!;
    const rule = byStage(r.changes, 'rule')[0]!;
    expect(rule.anchor).toEqual({ kind: 'original', unit: 'text', start: 0, end: 5 });
    expect(rule.from).toBe(garbled);
    expect(rule.dependsOn).toEqual([repair.id]);

    // Rule rejected: the repair and Stage 2 apply as usual.
    expect(r.out(reject(r.changes, rule.id))).toBe('Cafe au lait');
    // Repair rejected: the rule can't apply either.
    expect(r.out(reject(r.changes, repair.id))).toBe(`${garbled} au lait`);
  });

  it('a match covering part of a multi-character repair keeps the rest of the repair', () => {
    const r = run(mojibake('中文'), { rules: { replace: [replace('zh', '中', 'Zhong ')] } });
    expect(r.out()).toBe('Zhong 文');
    const rule = byStage(r.changes, 'rule')[0]!;
    expect(rule.anchor).toMatchObject({ kind: 'inParent', offsetInParent: 0, length: 1 });
  });

  it('with Stage 1 off, rules see the garbled text as it is', () => {
    const r = run(mojibake('é'), {
      stages: { encoding: false },
      rules: { replace: [replace('fix', 'Ã©', 'e')] },
    });
    expect(r.out()).toBe('e');
  });
});

describe('several rules', () => {
  it('overlapping rules: the earlier rule in the list wins', () => {
    const rules = [replace('first', 'abc', 'X'), replace('second', 'bcd', 'Y')];
    expect(run('abcd', { rules: { replace: rules } }).out()).toBe('Xd');
    expect(run('abcd', { rules: { replace: [...rules].reverse() } }).out()).toBe('aY');
  });

  it('two rules for the same text: only the first one makes a change', () => {
    const r = run('™', {
      rules: { replace: [replace('plain', '™', 'TM'), replace('brackets', '™', '(TM)')] },
    });
    expect(r.out()).toBe('TM');
    expect(byStage(r.changes, 'rule').map((c) => c.reason)).toEqual(['plain']);
  });

  it('rules match the text before any rule, not each other’s output', () => {
    const r = run('ab', {
      rules: { replace: [replace('a→b', 'a', 'b'), replace('b→c', 'b', 'c')] },
    });
    expect(r.out()).toBe('bc');
  });

  it('every occurrence is its own change, each can be rejected', () => {
    const r = run('™ and ™', { rules: { replace: [replace('plain', '™', 'TM')] } });
    const rules = byStage(r.changes, 'rule');
    expect(rules).toHaveLength(2);
    expect(r.out(reject(r.changes, rules[1]!.id))).toBe('TM and ™');
  });
});

describe('keep rules', () => {
  it('Stage 2 leaves kept characters alone and still changes the rest', () => {
    const r = run('Café naïve', { ...ASCII, rules: { keep: [{ name: 'keep é', text: 'é' }] } });
    expect(r.out()).toBe('Café naive');
  });

  it('keeps text inside a Stage 1 repair', () => {
    const r = run(mojibake('Café naïve'), {
      ...ASCII,
      rules: { keep: [{ name: 'keep é', text: 'é' }] },
    });
    expect(r.out()).toBe('Café naive');
  });

  it('a kept word protects all of its characters', () => {
    const r = run('Müller and Mül', {
      ...ASCII,
      rules: { keep: [{ name: 'name', text: 'Müller' }] },
    });
    expect(r.out()).toBe('Müller and Mul');
  });

  it('kept characters are not reported as "still not ASCII"', () => {
    const options: PipelineOptions = { ...ASCII, rules: { keep: [{ name: 'keep é', text: 'é' }] } };
    const doc = parseText('Café ☃');
    const out = applyChanges(doc, analyze(doc, options).changes, options);
    expect(out.report.nonAscii.map((c) => c.char)).toEqual(['☃']);
  });

  it('a replace rule still applies to kept text (keep only limits Stage 2)', () => {
    const r = run('é', {
      ...ASCII,
      rules: { keep: [{ name: 'keep é', text: 'é' }], replace: [replace('e', 'é', 'e')] },
    });
    expect(r.out()).toBe('e');
  });
});

describe('formats', () => {
  it('CSV: rules apply per cell and never match across cells', () => {
    const doc = parseCsv('name,mark\nAcme™,x\n');
    const options: PipelineOptions = {
      ...ASCII,
      rules: { replace: [replace('TM plain', '™', 'TM'), replace('across', '™,x', 'BAD')] },
    };
    const { changes } = analyze(doc, options);
    expect(byStage(changes, 'rule')).toHaveLength(1);
    expect(byStage(changes, 'rule')[0]!.location).toMatchObject({ type: 'csv', row: 2, column: 1 });
    expect(render(applyChanges(doc, changes, options))).toBe('name,mark\nAcmeTM,x\n');
  });

  it('CSV: a rule on a repaired cell keeps the quoting', () => {
    const doc = parseCsv(`"${mojibake('Café')}, Paris",1\n`);
    const options: PipelineOptions = { rules: { replace: [replace('Coffee', 'Café', 'Coffee')] } };
    const { changes } = analyze(doc, options);
    expect(render(applyChanges(doc, changes, options))).toBe('"Coffee, Paris",1\n');
  });

  it('Excel: rules and keep rules apply to text cells', async () => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'office');
    const doc = await readWorkbook(
      new Uint8Array(readFileSync(join(dir, 'formulas.xlsx'))),
      'xlsx',
    );
    const options: PipelineOptions = {
      ...ASCII,
      rules: {
        replace: [replace('Coffee', 'café', 'coffee')],
        keep: [{ name: 'keep ü', text: 'ü' }],
      },
    };
    const { changes } = analyze(doc, options);
    const out = applyChanges(doc, changes, options) as SheetDoc;
    const cell = (sheet: string, address: string) =>
      out.cells.find((c) => c.sheet === sheet && c.address === address)?.value;
    expect(cell('Data', 'A2')).toBe('coffee');
    expect(cell('Notes ü', 'A1')).toBe('Grün');
    expect(byStage(changes, 'rule')[0]!.location).toMatchObject({ type: 'sheet', cell: 'A2' });
  });
});

describe('any rules, any decisions', () => {
  // Pieces that make repairs, Stage 2 changes, BOMs and rule matches meet and overlap.
  const piece = fc.constantFrom(
    'a',
    'b',
    'é',
    '™',
    ' ',
    mojibake('é'),
    mojibake('™'),
    mojibake('中'),
    '﻿',
    '…',
  );
  const text = fc.array(piece, { maxLength: 12 }).map((p) => p.join(''));
  const ruleText = fc
    .array(fc.constantFrom('a', 'b', 'é', '™', ' ', 'Ã', '中'), { minLength: 1, maxLength: 3 })
    .map((p) => p.join(''));
  const rules = fc.record({
    replace: fc.array(
      fc.record({
        name: fc.constant('r'),
        from: ruleText,
        to: fc.constantFrom('', 'X', 'é', 'TM'),
      }),
      { maxLength: 4 },
    ),
    keep: fc.array(fc.record({ name: fc.constant('k'), text: ruleText }), { maxLength: 2 }),
  });

  it('changes stay valid and apply cleanly whatever the user accepts or rejects', () => {
    fc.assert(
      fc.property(text, rules, fc.array(fc.boolean(), { maxLength: 40 }), (t, rs, flips) => {
        const options: PipelineOptions = { ...ASCII, rules: rs };
        const doc = parseText(t);
        const { changes } = analyze(doc, options);
        validateChanges(changes, () => t);
        let decided = changes;
        changes.forEach((c, i) => {
          if (flips[i]) decided = setDecision(decided, c.id, false);
        });
        expect(() => applyChanges(doc, decided, options)).not.toThrow();
        // And with every change as proposed.
        expect(() => applyChanges(doc, changes, options)).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });
});

describe('preview', () => {
  it('a rule across a repair shows one mark: the applied one', async () => {
    const { preview } = await import('../src/index');
    const garbled = mojibake('Café');
    const options: PipelineOptions = { rules: { replace: [replace('Coffee', 'Café', 'Coffee')] } };
    const doc = parseText(garbled);
    const { changes } = analyze(doc, options);
    const rule = byStage(changes, 'rule')[0]!;
    const repair = byStage(changes, 'encoding')[0]!;
    expect(preview(doc, changes).marks.map((m) => m.id)).toEqual([rule.id]);
    // Rule rejected: the repair is the applied change there.
    const rejected = setDecision(changes, rule.id, false);
    expect(preview(doc, rejected).marks.map((m) => m.id)).toEqual([repair.id]);
    expect(preview(doc, rejected).edits.map((e) => e.text)).toEqual(['é']);
  });
});

describe('overriddenBy', () => {
  it('lists the accepted changes a rule replaces, and nothing once the rule is rejected', async () => {
    const { overriddenBy } = await import('../src/index');
    const r = run(`Acme™ ${mojibake('™')}`, {
      ...ASCII,
      rules: { replace: [replace('TM plain', '™', 'TM')] },
    });
    const rules = byStage(r.changes, 'rule');
    const ascii = byStage(r.changes, 'ascii');
    expect(rules).toHaveLength(2);
    expect(ascii).toHaveLength(2); // the plain ™, and the ™ inside the repair
    const map = overriddenBy(r.changes);
    expect(map.get(ascii[0]!.id)).toBe(rules[0]!.id);
    expect(map.get(ascii[1]!.id)).toBe(rules[1]!.id);
    expect(overriddenBy(reject(r.changes, rules[0]!.id)).has(ascii[0]!.id)).toBe(false);
  });
});
