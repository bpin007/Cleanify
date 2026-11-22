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
 */
import type { Change } from '../types';
import { ChangeModelError, indexById, isApplied } from './model';

export function applyToUnit(unit: string, original: string, changes: readonly Change[]): string {
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
    const kids = (children.get(c.id) ?? []).slice().sort(byOffsetDesc);
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
  top.sort(byStartDesc);

  let text = original;
  // Working from the end, each change must end at or before the previous change's start.
  let limit = original.length;
  for (const c of top) {
    if (c.anchor.kind !== 'original') continue;
    const { start, end } = c.anchor;
    if (end > original.length || start < 0 || end < start) {
      throw new ChangeModelError(`${c.id}: offsets outside unit ${unit}`);
    }
    if (end > limit) throw new ChangeModelError(`${c.id} overlaps another applied change`);
    text = text.slice(0, start) + outputOf(c) + text.slice(end);
    limit = start;
  }
  return text;
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
