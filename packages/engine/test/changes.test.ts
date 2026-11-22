/**
 * Change model, positions and applyChanges — PROJECT.md section 13, decisions D2/D3.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyToUnit } from '../src/changes/apply';
import {
  ChangeModelError,
  appliedIds,
  canAccept,
  indexById,
  isApplied,
  setDecision,
  setGroupDecision,
  validateChanges,
} from '../src/changes/model';
import { analyzeUnits, type PipelineUnit } from '../src/pipeline/analyze';
import type { Change } from '../src/types';
import { CP1252_SPECIALS, mojibake } from './helpers';

const unit = (text: string): PipelineUnit => ({
  id: 'u',
  text,
  locate: (offset) => ({ type: 'text', line: 1, column: offset + 1, offset }),
});

function analyzeOne(text: string) {
  return analyzeUnits([unit(text)], { stages: { encoding: true, ascii: true } }).changes;
}

const apply = (text: string, changes: Change[]) => applyToUnit('u', text, changes);

function mk(id: string, partial: Partial<Change> & Pick<Change, 'anchor'>): Change {
  return {
    id,
    stage: 'ascii',
    kind: 'test',
    from: '',
    to: '',
    reason: 'test',
    confidence: 'high',
    location: { type: 'text', line: 1, column: 1, offset: 0 },
    accepted: true,
    ...partial,
  };
}

describe('nested changes: Stage 2 inside a Stage 1 repair', () => {
  const text = 'CafÃ© ok';
  const changes = analyzeOne(text);
  const e = changes.find((c) => c.stage === 'encoding')!;
  const a = changes.find((c) => c.stage === 'ascii')!;

  it('anchors the repair to the original and the accent change inside it', () => {
    expect(e).toMatchObject({
      from: 'Ã©',
      to: 'é',
      anchor: { kind: 'original', unit: 'u', start: 3, end: 5 },
    });
    expect(a).toMatchObject({
      from: 'é',
      to: 'e',
      anchor: { kind: 'inParent', parentId: e.id, offsetInParent: 0, length: 1 },
      dependsOn: [e.id],
    });
  });

  it('applies both, either or neither', () => {
    expect(apply(text, changes)).toBe('Cafe ok');
    expect(apply(text, setDecision(changes, a.id, false))).toBe('Café ok');
    expect(apply(text, setDecision(changes, e.id, false))).toBe('CafÃ© ok');
  });

  it('shows the inner change at the location of its parent in the original', () => {
    expect(a.location).toEqual(e.location);
  });
});

describe('dependsOn rules (section 13)', () => {
  const text = 'CafÃ©';
  const base = analyzeOne(text);
  const e = base.find((c) => c.stage === 'encoding')!;
  const a = base.find((c) => c.stage === 'ascii')!;

  it('rejecting a parent auto-rejects its dependents without touching their decision', () => {
    const after = setDecision(base, e.id, false);
    const byId = indexById(after);
    expect(isApplied(byId.get(a.id)!, byId)).toBe(false);
    expect(byId.get(a.id)!.accepted).toBe(true);
  });

  it('re-accepting the parent restores the dependents', () => {
    const after = setDecision(setDecision(base, e.id, false), e.id, true);
    expect(appliedIds(after).has(a.id)).toBe(true);
  });

  it('a dependent rejected by hand stays rejected after the parent is re-accepted', () => {
    let s = setDecision(base, a.id, false);
    s = setDecision(s, e.id, false);
    s = setDecision(s, e.id, true);
    expect(appliedIds(s).has(a.id)).toBe(false);
  });

  it('a dependent cannot be accepted while its parent is rejected', () => {
    let s = setDecision(base, a.id, false);
    s = setDecision(s, e.id, false);
    expect(
      canAccept(
        s.find((c) => c.id === a.id)!,
        s,
      ),
    ).toBe(false);
    const tried = setDecision(s, a.id, true);
    expect(tried.find((c) => c.id === a.id)!.accepted).toBe(false);
  });

  it('accept/reject a whole group', () => {
    const none = setGroupDecision(base, () => true, false);
    expect(appliedIds(none).size).toBe(0);
    expect(apply(text, none)).toBe(text);
  });

  it('throws for an unknown id', () => {
    expect(() => setDecision(base, 'nope', true)).toThrow(ChangeModelError);
  });
});

describe('translation changes (section 13, decision D2)', () => {
  // "Ã‡a va" → repair Ã‡→Ç (e1), translate "Ça va" → "It's fine" (t1, depends on e1),
  // then ASCII on the English: ’ → ' inside t1 (a1).
  const text = 'Ã‡a va';
  const e1 = mk('e1', {
    stage: 'encoding',
    from: 'Ã‡',
    to: 'Ç',
    anchor: { kind: 'original', unit: 'u', start: 0, end: 2 },
  });
  const t1 = mk('t1', {
    stage: 'translate',
    from: 'Ça va',
    to: 'It’s fine',
    dependsOn: ['e1'],
    anchor: { kind: 'original', unit: 'u', start: 0, end: 6 },
  });
  const a1 = mk('a1', {
    from: '’',
    to: "'",
    dependsOn: ['t1'],
    anchor: { kind: 'inParent', parentId: 't1', offsetInParent: 2, length: 1 },
  });
  const all = [e1, t1, a1];

  it('the translation replaces its unit and the repair inside it is not applied twice', () => {
    validateChanges(all, () => text);
    expect(apply(text, all)).toBe("It's fine");
  });

  it('rejecting the repair auto-rejects the translation (re-translate is the user’s call)', () => {
    expect(apply(text, setDecision(all, 'e1', false))).toBe('Ã‡a va');
  });

  it('re-accepting the repair restores the original translation without a new request', () => {
    expect(apply(text, setDecision(setDecision(all, 'e1', false), 'e1', true))).toBe("It's fine");
  });

  it('rejecting the translation keeps the repair', () => {
    expect(apply(text, setDecision(all, 't1', false))).toBe('Ça va');
  });
});

describe('validation', () => {
  const text = 'abcdef';
  const unitText = () => text;

  it('requires an inParent change to list its parent in dependsOn', () => {
    const p = mk('p', { to: 'xy', anchor: { kind: 'original', unit: 'u', start: 0, end: 1 } });
    const c = mk('c', {
      anchor: { kind: 'inParent', parentId: 'p', offsetInParent: 0, length: 1 },
    });
    expect(() => validateChanges([p, c], unitText)).toThrow(/dependsOn/);
    expect(() => validateChanges([c], unitText)).toThrow(/not found/);
    const far = mk('f', {
      dependsOn: ['p'],
      anchor: { kind: 'inParent', parentId: 'p', offsetInParent: 1, length: 5 },
    });
    expect(() => validateChanges([p, far], unitText)).toThrow(/outside/);
  });

  it('rejects overlapping top-level changes and out-of-range offsets', () => {
    const a = mk('a', { anchor: { kind: 'original', unit: 'u', start: 0, end: 3 } });
    const b = mk('b', { anchor: { kind: 'original', unit: 'u', start: 2, end: 4 } });
    expect(() => validateChanges([a, b], unitText)).toThrow(/overlap/);
    expect(() => apply(text, [a, b])).toThrow(ChangeModelError);
    const bad = mk('x', { anchor: { kind: 'original', unit: 'u', start: 4, end: 9 } });
    expect(() => validateChanges([bad], unitText)).toThrow(/outside/);
    expect(() => apply(text, [bad])).toThrow(/outside/);
    const lost = mk('y', { anchor: { kind: 'original', unit: 'zz', start: 0, end: 1 } });
    expect(() => validateChanges([lost], () => undefined)).toThrow(/unknown unit/);
  });

  it('rejects overlapping children inside one parent', () => {
    const p = mk('p', { to: 'abcd', anchor: { kind: 'original', unit: 'u', start: 0, end: 1 } });
    const c1 = mk('c1', {
      dependsOn: ['p'],
      anchor: { kind: 'inParent', parentId: 'p', offsetInParent: 0, length: 3 },
    });
    const c2 = mk('c2', {
      dependsOn: ['p'],
      anchor: { kind: 'inParent', parentId: 'p', offsetInParent: 2, length: 2 },
    });
    expect(() => apply(text, [p, c1, c2])).toThrow(/overlaps/);
  });

  it('every change the pipeline produces passes validation', () => {
    const t = mojibake('José “café” – 😀 Grüße') + ' plain text​';
    validateChanges(analyzeOne(t), () => t);
  });
});

// ── Property tests (decision D3) ─────────────────────────────────────────────

/** Independent reference: apply changes front to back, tracking how offsets shift. */
function referenceApply(text: string, changes: Change[]): string {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  const on = changes.filter((c) => isApplied(c, byId, memo));
  const kids = (id: string) =>
    on
      .filter((c) => c.anchor.kind === 'inParent' && c.anchor.parentId === id)
      .sort((x, y) => off(x) - off(y));
  const off = (c: Change) =>
    c.anchor.kind === 'inParent' ? c.anchor.offsetInParent : c.anchor.start;
  const len = (c: Change) =>
    c.anchor.kind === 'inParent' ? c.anchor.length : c.anchor.end - c.anchor.start;
  const output = (c: Change): string => {
    let s = c.to;
    let delta = 0;
    for (const k of kids(c.id)) {
      const o = output(k);
      s = s.slice(0, off(k) + delta) + o + s.slice(off(k) + delta + len(k));
      delta += o.length - len(k);
    }
    return s;
  };
  let s = text;
  let delta = 0;
  for (const c of on.filter((c) => c.anchor.kind === 'original').sort((x, y) => off(x) - off(y))) {
    const o = output(c);
    s = s.slice(0, off(c) + delta) + o + s.slice(off(c) + delta + len(c));
    delta += o.length - len(c);
  }
  return s;
}

const piece = fc.oneof(
  fc.constantFrom(...'abc XYZ,.\n'),
  fc.constantFrom(...'éñüßÆøłąśğ'),
  fc.constantFrom(...CP1252_SPECIALS, '«', '»', '©', ' ', '​', '\u007F', '😀'),
);
// Mix of garbled and clean pieces, so we get top-level, nested and standalone changes.
const docText = fc
  .array(fc.tuple(fc.array(piece, { minLength: 1, maxLength: 6 }), fc.boolean()), { maxLength: 8 })
  .map((parts) =>
    parts.map(([p, garble]) => (garble ? mojibake(p.join('')) : p.join(''))).join(''),
  );

const withDecisions = docText.chain((t) => {
  const changes = analyzeOne(t);
  return fc
    .tuple(
      fc.array(fc.boolean(), { minLength: changes.length, maxLength: changes.length }),
      fc.integer(),
    )
    .map(([d, seed]) => ({ t, changes: changes.map((c, i) => ({ ...c, accepted: d[i]! })), seed }));
});

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed | 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) | 0;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('properties (fast-check)', () => {
  it('rejecting every change returns the original text exactly', () => {
    fc.assert(
      fc.property(docText, (t) => {
        const none = analyzeOne(t).map((c) => ({ ...c, accepted: false }));
        return apply(t, none) === t;
      }),
      { numRuns: 300 },
    );
  });

  it('the result does not depend on the order of the change list', () => {
    fc.assert(
      fc.property(
        withDecisions,
        ({ t, changes, seed }) => apply(t, changes) === apply(t, shuffle(changes, seed)),
      ),
      { numRuns: 300 },
    );
  });

  it('reverse-order application equals front-to-back application with offset tracking', () => {
    fc.assert(
      fc.property(
        withDecisions,
        ({ t, changes }) => apply(t, changes) === referenceApply(t, changes),
      ),
      { numRuns: 300 },
    );
  });

  it('a rejected parent never leaves any of its children applied', () => {
    fc.assert(
      fc.property(withDecisions, ({ t, changes }) => {
        const ids = appliedIds(changes);
        const consistent = changes.every(
          (c) => !ids.has(c.id) || (c.dependsOn ?? []).every((p) => ids.has(p)),
        );
        const withoutUnapplied = changes.filter((c) => ids.has(c.id));
        return consistent && apply(t, changes) === apply(t, withoutUnapplied);
      }),
      { numRuns: 300 },
    );
  });

  it('random accept/reject sequences always end in a consistent state', () => {
    fc.assert(
      fc.property(
        docText.chain((t) => {
          const changes = analyzeOne(t);
          const ids = changes.map((c) => c.id);
          return fc.tuple(
            fc.constant(changes),
            ids.length === 0
              ? fc.constant([] as [string, boolean][])
              : fc.array(fc.tuple(fc.constantFrom(...ids), fc.boolean()), { maxLength: 30 }),
          );
        }),
        ([changes, steps]) => {
          let s = changes;
          for (const [id, acc] of steps) s = setDecision(s, id, acc);
          const ids = appliedIds(s);
          return s.every((c) => !ids.has(c.id) || (c.dependsOn ?? []).every((p) => ids.has(p)));
        },
      ),
      { numRuns: 300 },
    );
  });
});
