/**
 * The analysis pipeline, shared by every format adapter (PROJECT.md sections 5, 13).
 *
 * Per unit: Stage 1 runs on the original text. Stage 2 runs on Stage 1's output;
 * each Stage 2 proposal that falls inside a Stage 1 repair is anchored
 * `inParent` to that repair (with `dependsOn`), every other one to the original
 * text (decision D3). Warnings are scanned on the repaired text and located in
 * the original. (Stage 3, translation, joins in Phase 4.)
 */
import { findStage2 } from '../ascii/stage2';
import { findMojibake } from '../mojibake/repair';
import type { Proposal } from '../proposal';
import { scanWarnings } from '../scan/warnings';
import type { AnalysisResult, Change, EngineWarning, Location, PipelineOptions } from '../types';

export interface PipelineUnit {
  id: string;
  text: string;
  /** Location of a UTF-16 offset in this unit's ORIGINAL text. */
  locate(offset: number): Location;
}

interface Segment {
  origStart: number;
  origEnd: number;
  outStart: number;
  outEnd: number;
  changeId: string | null;
}

const PREFIX: Record<Change['stage'], string> = {
  encoding: 'e',
  ascii: 'a',
  invisible: 'i',
  translate: 't',
  safety: 's',
};

/** BOMs inside a unit (Stage 1): extra BOMs at the start, or BOMs in the middle (#9). */
function findBoms(text: string): Proposal[] {
  const out: Proposal[] = [];
  for (let i = text.indexOf('﻿'); i >= 0; i = text.indexOf('﻿', i + 1)) {
    out.push({
      start: i,
      end: i + 1,
      from: '﻿',
      to: '',
      stage: 'encoding',
      kind: 'bom',
      reason:
        i === 0
          ? 'Extra byte order mark at the start (the file had more than one)'
          : 'Byte order mark inside the text',
      confidence: 'high',
    });
  }
  return out;
}

export function analyzeUnits(
  units: readonly PipelineUnit[],
  options: PipelineOptions = {},
): AnalysisResult {
  const stage1 = options.stages?.encoding ?? true;
  const stage2 = options.stages?.ascii ?? false;
  const counters: Record<string, number> = {};
  const nextId = (stage: Change['stage']) => {
    const p = PREFIX[stage];
    counters[p] = (counters[p] ?? 0) + 1;
    return `${p}${counters[p]}`;
  };

  const changes: Change[] = [];
  const warnings: EngineWarning[] = [];
  let mojibakeChars = 0;
  let clearRepairs = 0;
  const ambiguous: Change[] = [];
  let nonAsciiChars = 0;

  units.forEach((unit, unitIndex) => {
    const text = unit.text;
    for (const ch of text) if (ch.codePointAt(0)! >= 0x80) nonAsciiChars++;

    const toChange = (p: Proposal, anchorStart: number, extra?: Partial<Change>): Change => ({
      id: nextId(p.stage),
      stage: p.stage,
      kind: p.kind,
      from: p.from,
      to: p.to,
      reason: p.reason,
      confidence: p.confidence,
      anchor: { kind: 'original', unit: unit.id, start: p.start, end: p.end },
      location: unit.locate(anchorStart),
      accepted: p.accepted ?? p.confidence === 'high',
      ...extra,
    });

    // ── Stage 1 on the original text ─────────────────────────────────────
    const s1 = stage1
      ? [...findMojibake(text), ...findBoms(text)].sort((a, b) => a.start - b.start)
      : [];
    const segments: Segment[] = [];
    let out = '';
    let pos = 0;
    const startsWithBom = text.startsWith('﻿');
    for (const p of s1) {
      if (p.start < pos) continue; // never overlap (defensive)
      if (p.start > pos) {
        segments.push({
          origStart: pos,
          origEnd: p.start,
          outStart: out.length,
          outEnd: out.length + p.start - pos,
          changeId: null,
        });
        out += text.slice(pos, p.start);
      }
      const change = toChange(p, p.start, p.ambiguous ? { accepted: false } : {});
      changes.push(change);
      if (p.ambiguous) ambiguous.push(change);
      else if (p.kind === 'mojibake' && p.confidence === 'high') clearRepairs++;
      if (p.kind === 'mojibake') mojibakeChars += [...p.from].length;
      segments.push({
        origStart: p.start,
        origEnd: p.end,
        outStart: out.length,
        outEnd: out.length + p.to.length,
        changeId: change.id,
      });
      out += p.to;
      pos = p.end;
    }
    if (pos < text.length || segments.length === 0) {
      segments.push({
        origStart: pos,
        origEnd: text.length,
        outStart: out.length,
        outEnd: out.length + text.length - pos,
        changeId: null,
      });
      out += text.slice(pos);
    }

    const segmentAt = (offset: number): Segment =>
      segments.find((s) => offset >= s.outStart && offset < s.outEnd) ??
      segments.find((s) => offset >= s.outStart && offset <= s.outEnd) ??
      segments[segments.length - 1]!;
    const toOriginal = (offset: number): number => {
      const s = segmentAt(offset);
      return s.changeId ? s.origStart : s.origStart + (offset - s.outStart);
    };

    // ── Warnings (always) ────────────────────────────────────────────────
    if (unitIndex === 0 && startsWithBom) {
      warnings.push({
        kind: 'double-bom',
        severity: 'warning',
        message:
          'The file starts with more than one byte order mark (BOM). The extra one can be removed.',
        location: unit.locate(0),
      });
    }
    for (const w of scanWarnings(out)) {
      warnings.push({
        kind: w.kind,
        severity: w.severity,
        message: w.message,
        location: unit.locate(toOriginal(w.offset)),
      });
    }

    // ── Stage 2 on Stage 1's output ──────────────────────────────────────
    if (!stage2) return;
    for (const p of findStage2(out, options.ascii ?? {})) {
      const seg = segmentAt(p.start);
      if (p.end > seg.outEnd) continue; // would straddle a repair boundary: skip
      if (seg.changeId === null) {
        const start = seg.origStart + (p.start - seg.outStart);
        const end = start + (p.end - p.start);
        changes.push(toChange({ ...p, start, end }, start));
      } else {
        const parent = changes.find((c) => c.id === seg.changeId)!;
        changes.push(
          toChange(p, seg.origStart, {
            anchor: {
              kind: 'inParent',
              parentId: parent.id,
              offsetInParent: p.start - seg.outStart,
              length: p.end - p.start,
            },
            dependsOn: [parent.id],
          }),
        );
      }
    }
  });

  // Ambiguous pairs like `Ä…` (D11): accepted only when the same file has clear repairs.
  for (const c of ambiguous) {
    c.accepted = clearRepairs > 0;
    c.reason +=
      clearRepairs > 0
        ? '. Accepted because other text in this file is clearly garbled.'
        : '. Not accepted because nothing else in this file looks garbled.';
  }

  if (mojibakeChars >= 6 && mojibakeChars >= nonAsciiChars * 0.5) {
    warnings.push({
      kind: 'whole-file-mojibake',
      severity: 'info',
      message:
        'This text looks like UTF-8 that was read as Windows-1252 throughout. All repairs can be accepted at once.',
    });
  }

  return { changes, warnings };
}
