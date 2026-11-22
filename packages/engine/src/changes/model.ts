/**
 * Change model — PROJECT.md section 13 ("Dependent changes", "Positions").
 *
 * `accepted` is the user's own decision. Whether a change is actually applied also
 * depends on its parents: a change is applied only if it is accepted AND every
 * change in `dependsOn` is applied. So rejecting a parent "auto-rejects" its
 * dependents without touching their own decision, and re-accepting the parent
 * restores them; a dependent the user rejected by hand stays rejected.
 */
import type { Change } from '../types';

export class ChangeModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeModelError';
  }
}

export function indexById(changes: readonly Change[]): Map<string, Change> {
  return new Map(changes.map((c) => [c.id, c]));
}

/** Is this change applied (accepted, and all its parents applied)? */
export function isApplied(
  change: Change,
  byId: ReadonlyMap<string, Change>,
  memo: Map<string, boolean> = new Map(),
): boolean {
  const cached = memo.get(change.id);
  if (cached !== undefined) return cached;
  memo.set(change.id, false); // guards against cycles
  let applied = change.accepted;
  for (const pid of change.dependsOn ?? []) {
    const parent = byId.get(pid);
    if (!applied) break;
    applied = parent !== undefined && isApplied(parent, byId, memo);
  }
  memo.set(change.id, applied);
  return applied;
}

/** Ids of every applied change. */
export function appliedIds(changes: readonly Change[]): Set<string> {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  return new Set(changes.filter((c) => isApplied(c, byId, memo)).map((c) => c.id));
}

/** True when the change could be applied if accepted (all parents applied). */
export function canAccept(change: Change, changes: readonly Change[]): boolean {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  return (change.dependsOn ?? []).every((pid) => {
    const p = byId.get(pid);
    return p !== undefined && isApplied(p, byId, memo);
  });
}

/**
 * Records the user's decision for one change. Accepting a change whose parent is
 * rejected is refused (section 13: "a dependent can't be accepted while its
 * parent is rejected") and returns the list unchanged.
 */
export function setDecision(changes: readonly Change[], id: string, accepted: boolean): Change[] {
  const target = changes.find((c) => c.id === id);
  if (!target) throw new ChangeModelError(`No change with id ${id}`);
  if (accepted && !canAccept(target, changes)) return [...changes];
  return changes.map((c) => (c.id === id ? { ...c, accepted } : c));
}

/** "Accept all / Reject all" for a group (e.g. every change of one kind). */
export function setGroupDecision(
  changes: readonly Change[],
  inGroup: (c: Change) => boolean,
  accepted: boolean,
): Change[] {
  return changes.map((c) => (inGroup(c) ? { ...c, accepted } : c));
}

/**
 * Checks the structural rules of section 13:
 * - an `inParent` change lists its parent in `dependsOn`, and the parent exists;
 * - offsets are inside the text they point into;
 * - top-level changes in one unit don't overlap (a translation may cover others).
 */
export function validateChanges(
  changes: readonly Change[],
  unitText: (unit: string) => string | undefined,
): void {
  const byId = indexById(changes);
  const perUnit = new Map<string, Change[]>();

  for (const c of changes) {
    if (c.anchor.kind === 'inParent') {
      const parent = byId.get(c.anchor.parentId);
      if (!parent) throw new ChangeModelError(`${c.id}: parent ${c.anchor.parentId} not found`);
      if (!c.dependsOn?.includes(c.anchor.parentId)) {
        throw new ChangeModelError(
          `${c.id}: inside ${parent.id} but does not list it in dependsOn`,
        );
      }
      const { offsetInParent: o, length } = c.anchor;
      if (o < 0 || length < 0 || o + length > parent.to.length) {
        throw new ChangeModelError(`${c.id}: offsets outside the output of ${parent.id}`);
      }
    } else {
      const text = unitText(c.anchor.unit);
      if (text === undefined) throw new ChangeModelError(`${c.id}: unknown unit ${c.anchor.unit}`);
      const { start, end } = c.anchor;
      if (start < 0 || end < start || end > text.length) {
        throw new ChangeModelError(
          `${c.id}: offsets ${start}–${end} outside unit ${c.anchor.unit}`,
        );
      }
      const list = perUnit.get(c.anchor.unit) ?? [];
      list.push(c);
      perUnit.set(c.anchor.unit, list);
    }
  }

  for (const list of perUnit.values()) {
    const plain = list.filter((c) => c.stage !== 'translate');
    plain.sort((a, b) => start(a) - start(b));
    for (let k = 1; k < plain.length; k++) {
      if (start(plain[k]!) < end(plain[k - 1]!)) {
        throw new ChangeModelError(`${plain[k - 1]!.id} and ${plain[k]!.id} overlap`);
      }
    }
  }
}

const start = (c: Change) => (c.anchor.kind === 'original' ? c.anchor.start : 0);
const end = (c: Change) => (c.anchor.kind === 'original' ? c.anchor.end : 0);
