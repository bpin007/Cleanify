/**
 * applyChanges for one unit — PROJECT.md section 13, decision D3.
 *
 * 1. Take the applied top-level changes of the unit (anchored to the ORIGINAL text).
 * 2. Build each one's output: its `to` with its applied `inParent` children
 *    spliced in, highest offset first (recursively).
 * 3. Splice the outputs into the original, highest start first, so no offset
 *    ever shifts.
 * A translation replaces its whole range; the Stage 1 changes inside it are its
 * parents and are already part of its `to`, so they are not applied again.
 * A user's rule runs before Stage 2 (section 5), so an applied rule takes precedence
 * over every other change it overlaps, at the top level and inside a repair: those are
 * left out while the rule is applied, and come back if it is rejected.
 */
import type { Change } from '../types';
import { ChangeModelError, indexById, isApplied } from './model';

/** One applied top-level change of a unit and the text it produces (children included). */
export interface AppliedEdit {
  change: Change;
  start: number;
  end: number;
  output: string;
}

export function applyToUnit(unit: string, original: string, changes: readonly Change[]): string {
  let text = original;
  // Edits come back highest start first, so splicing never shifts an offset.
  for (const e of appliedEdits(unit, original, changes)) {
    text = text.slice(0, e.start) + e.output + text.slice(e.end);
  }
  return text;
}

/**
 * The applied top-level edits of a unit, highest start first, each with its final
 * output. Throws ChangeModelError on offsets outside the unit or overlaps.
 */
export function appliedEdits(
  unit: string,
  original: string,
  changes: readonly Change[],
): AppliedEdit[] {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  const applied = (c: Change) => isApplied(c, byId, memo);

  const children = new Map<string, Change[]>();
  for (const c of changes) {
    if (c.anchor.kind === 'inParent' && applied(c)) {
      const list = children.get(c.anchor.parentId) ?? [];
      list.push(c);
      children.set(c.anchor.parentId, list);
    }
  }

  const outputOf = (c: Change, depth = 0): string => {
    if (depth > 32) throw new ChangeModelError(`Changes nested too deeply at ${c.id}`);
    const kids = withoutRuleOverlaps(children.get(c.id) ?? []).sort(byOffsetDesc);
    let out = c.to;
    // Working from the end, each child must end at or before the previous child's start.
    let limit = c.to.length;
    for (const k of kids) {
      if (k.anchor.kind !== 'inParent') continue;
      const { offsetInParent: o, length } = k.anchor;
      if (o < 0 || length < 0 || o + length > c.to.length) {
        throw new ChangeModelError(`${k.id}: outside the output of ${c.id}`);
      }
      if (o + length > limit)
        throw new ChangeModelError(`${k.id} overlaps another change in ${c.id}`);
      out = out.slice(0, o) + outputOf(k, depth + 1) + out.slice(o + length);
      limit = o;
    }
    return out;
  };

  let top = changes.filter(
    (c) => c.anchor.kind === 'original' && c.anchor.unit === unit && applied(c),
  );
  const translations = top.filter((c) => c.stage === 'translate');
  if (translations.length > 0) {
    top = top.filter((c) => c.stage === 'translate' || !translations.some((t) => covers(t, c)));
  }
  top = withoutRuleOverlaps(top);
  top.sort(byStartDesc);

  const edits: AppliedEdit[] = [];
  // Working from the end, each change must end at or before the previous change's start.
  let limit = original.length;
  for (const c of top) {
    if (c.anchor.kind !== 'original') continue;
    const { start, end } = c.anchor;
    if (end > original.length || start < 0 || end < start) {
      throw new ChangeModelError(`${c.id}: offsets outside unit ${unit}`);
    }
    if (end > limit) throw new ChangeModelError(`${c.id} overlaps another applied change`);
    edits.push({ change: c, start, end, output: outputOf(c) });
    limit = start;
  }
  return edits;
}

/**
 * Applied changes that an applied rule overrides (left out of the output), mapped to
 * that rule's id. Changes nested in an overridden change are overridden with it.
 */
export function overriddenBy(changes: readonly Change[]): Map<string, string> {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  const containers = new Map<string, Change[]>();
  for (const c of changes) {
    if (!isApplied(c, byId, memo)) continue;
    const key = c.anchor.kind === 'original' ? `u:${c.anchor.unit}` : `p:${c.anchor.parentId}`;
    const list = containers.get(key) ?? [];
    list.push(c);
    containers.set(key, list);
  }
  const out = new Map<string, string>();
  for (const list of containers.values()) {
    const rules = list.filter((c) => c.stage === 'rule');
    for (const c of list) {
      if (c.stage === 'rule' || c.stage === 'translate') continue;
      const [s, e] = span(c);
      const rule = rules.find((r) => {
        const [rs, re] = span(r);
        return s < re && rs < e;
      });
      if (rule) out.set(c.id, rule.id);
    }
  }
  // Nested changes go with their overridden parent (parents come before children).
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of changes) {
      if (c.anchor.kind !== 'inParent' || out.has(c.id)) continue;
      const by = out.get(c.anchor.parentId);
      if (by !== undefined && isApplied(c, byId, memo)) {
        out.set(c.id, by);
        grew = true;
      }
    }
  }
  return out;
}

/** Changes in one container (a unit, or one parent's output). */
function span(c: Change): [number, number] {
  return c.anchor.kind === 'original'
    ? [c.anchor.start, c.anchor.end]
    : [c.anchor.offsetInParent, c.anchor.offsetInParent + c.anchor.length];
}

/** Drops every non-rule change that overlaps an applied rule (the list is all applied). */
function withoutRuleOverlaps(list: readonly Change[]): Change[] {
  const rules = list.filter((c) => c.stage === 'rule').map(span);
  if (rules.length === 0) return [...list];
  return list.filter((c) => {
    if (c.stage === 'rule') return true;
    const [s, e] = span(c);
    // Strict overlap: an insertion right at a rule's edge (the CSV guard) stays.
    return !rules.some(([rs, re]) => s < re && rs < e);
  });
}

function covers(outer: Change, inner: Change): boolean {
  if (outer.anchor.kind !== 'original' || inner.anchor.kind !== 'original') return false;
  return (
    outer.anchor.unit === inner.anchor.unit &&
    outer.anchor.start <= inner.anchor.start &&
    inner.anchor.end <= outer.anchor.end
  );
}

function byStartDesc(a: Change, b: Change): number {
  if (a.anchor.kind !== 'original' || b.anchor.kind !== 'original') return 0;
  return b.anchor.start - a.anchor.start || b.anchor.end - a.anchor.end;
}

function byOffsetDesc(a: Change, b: Change): number {
  if (a.anchor.kind !== 'inParent' || b.anchor.kind !== 'inParent') return 0;
  return b.anchor.offsetInParent - a.anchor.offsetInParent;
}
