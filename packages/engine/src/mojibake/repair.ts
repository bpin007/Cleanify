/**
 * Stage 1 — repair mojibake (PROJECT.md section 5).
 *
 * Reverses the wrong decoding step instead of searching and replacing strings:
 * characters are mapped back to the Windows-1252 bytes they came from, and those
 * bytes are decoded again as strict UTF-8. A repair is kept only when the result
 * is plausible (see plausible.ts). Garbled-twice text is repaired by repeating the
 * process on the repaired output (at most 3 passes in total).
 */
import { cp1252Byte } from '../charsets/cp1252';
import { decodeUtf8At } from '../charsets/utf8';
import type { Proposal } from '../proposal';
import { plausibility, scriptOf, type Plausibility } from './plausible';

const MAX_PASSES = 3;

interface Candidate {
  start: number;
  end: number;
  codePoint: number;
  plaus: Plausibility;
}

/** Every strict-UTF-8 sequence hidden in `text` as Windows-1252 characters. */
function findCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  // Map each UTF-16 position to its Windows-1252 byte (−1 = not representable / not a single unit).
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) bytes.push(cp1252Byte(text.charCodeAt(i)) ?? -1);

  let i = 0;
  while (i < text.length) {
    const b = bytes[i]!;
    if (b < 0xc2) {
      i++;
      continue;
    }
    const seq = decodeUtf8At(bytes, i);
    if (seq && seq.length > 1) {
      out.push({
        start: i,
        end: i + seq.length,
        codePoint: seq.codePoint,
        plaus: plausibility(seq.codePoint),
      });
      i += seq.length;
    } else {
      i++;
    }
  }
  return out;
}

const isAsciiLetter = (c: number | undefined) =>
  c !== undefined && ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a));

interface Group {
  start: number;
  end: number;
  cands: Candidate[];
}

function groupContiguous(cands: Candidate[]): Group[] {
  const groups: Group[] = [];
  for (const c of cands) {
    const last = groups.at(-1);
    if (last && last.end === c.start) {
      last.end = c.end;
      last.cands.push(c);
    } else {
      groups.push({ start: c.start, end: c.end, cands: [c] });
    }
  }
  return groups;
}

/** Scripts that appear in genuine (non-candidate) text of the unit. */
function genuineScripts(text: string, cands: Candidate[]): Set<Plausibility> {
  const inCandidate = new Uint8Array(text.length);
  for (const c of cands) inCandidate.fill(1, c.start, c.end);
  const scripts = new Set<Plausibility>();
  for (let i = 0; i < text.length; i++) {
    if (inCandidate[i]) continue;
    const cp = text.codePointAt(i)!;
    const s = scriptOf(cp);
    if (s) scripts.add(s);
    if (cp > 0xffff) i++;
  }
  return scripts;
}

interface PassResult {
  groups: { start: number; end: number; to: string; corroboratedByText: boolean }[];
}

/** One repair pass: which groups of candidates are accepted, and what they decode to. */
function repairPass(
  text: string,
  knownScripts: Set<Plausibility> | undefined,
  allowTransient: boolean,
): PassResult {
  let cands = findCandidates(text);
  if (cands.length === 0) return { groups: [] };
  const scripts = knownScripts ?? genuineScripts(text, cands);

  // Drop implausible candidates, then re-check corroboration until stable
  // (dropping one can break up a group and remove another's corroboration).
  let changed = true;
  const viaText = new Set<Candidate>();
  while (changed) {
    changed = false;
    const keep: Candidate[] = [];
    for (const g of groupContiguous(cands)) {
      const counts = new Map<Plausibility, number>();
      for (const c of g.cands) counts.set(c.plaus, (counts.get(c.plaus) ?? 0) + 1);
      for (const c of g.cands) {
        let ok: boolean;
        if (c.plaus === 'reject') ok = false;
        else if (c.plaus === 'common') ok = true;
        else if (c.plaus === 'transient') ok = allowTransient;
        else if (c.plaus === 'combining') ok = isAsciiLetter(text.charCodeAt(c.start - 1));
        else if ((counts.get(c.plaus) ?? 0) >= 2) ok = true;
        else if (scripts.has(c.plaus)) {
          ok = true;
          viaText.add(c);
        } else ok = false;
        if (ok) keep.push(c);
        else changed = true;
      }
    }
    cands = keep;
  }

  return {
    groups: groupContiguous(cands).map((g) => ({
      start: g.start,
      end: g.end,
      to: g.cands.map((c) => String.fromCodePoint(c.codePoint)).join(''),
      corroboratedByText: g.cands.some((c) => viaText.has(c)),
    })),
  };
}

/** Applies a pass's groups to a string. */
function applyGroups(text: string, groups: PassResult['groups']): string {
  let out = '';
  let pos = 0;
  for (const g of groups) {
    out += text.slice(pos, g.start) + g.to;
    pos = g.end;
  }
  return out + text.slice(pos);
}

/**
 * Proposes mojibake repairs for one unit of text. Each proposal covers one run of
 * garbled characters (e.g. ä¸­æ–‡ → 中文 is one proposal, not six).
 */
export function findMojibake(text: string): Proposal[] {
  const scripts = genuineScripts(text, findCandidates(text));
  const out: Proposal[] = [];
  for (const p of proposalsFor(text, scripts, true)) {
    if (!HAS_C1.test(p.to)) {
      out.push(p);
      continue;
    }
    // An intermediate control survived: repair this run again without allowing them.
    for (const q of proposalsFor(p.from, scripts, false)) {
      out.push({ ...q, start: q.start + p.start, end: q.end + p.start });
    }
  }
  return out;
}

const HAS_C1 = /[\u0080-\u009f]/;

function proposalsFor(
  text: string,
  scripts: Set<Plausibility>,
  allowTransient: boolean,
): Proposal[] {
  const first = repairPass(text, scripts, allowTransient);
  return first.groups.map((g) => {
    let to = g.to;
    let passes = 1;
    let viaText = g.corroboratedByText;
    while (passes < MAX_PASSES) {
      const next = repairPass(to, scripts, allowTransient);
      if (next.groups.length === 0) break;
      viaText ||= next.groups.some((n) => n.corroboratedByText);
      to = applyGroups(to, next.groups);
      passes++;
    }
    const times = passes === 1 ? '' : passes === 2 ? ' twice' : ' three times';
    return {
      start: g.start,
      end: g.end,
      from: text.slice(g.start, g.end),
      to,
      stage: 'encoding',
      kind: 'mojibake',
      reason: `Looks like UTF-8 text that was read as Windows-1252${times}`,
      confidence: viaText ? 'medium' : 'high',
    };
  });
}
