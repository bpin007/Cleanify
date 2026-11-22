/**
 * Preview data for a before/after view (PROJECT.md section 8, step 4 of the main flow).
 *
 * Both lists use offsets in the ORIGINAL rendered document (`render(doc)`: the text,
 * or the full CSV source), so a UI can split the original into lines and draw:
 * - `marks`: where every top-level change sits in the original (applied or not);
 * - `edits`: which original ranges are replaced in the output, and by what.
 * The output is the original with every edit spliced in.
 */
import { appliedEdits } from './changes/apply';
import { indexById, isApplied } from './changes/model';
import { cellUnitId, editedCells, valueOffsetToSource } from './formats/csv';
import { TEXT_UNIT } from './formats/text';
import type { Change, CsvCell, Doc, Stage } from './types';

export interface PreviewMark {
  start: number;
  /** Equal to `start` for an insertion (the CSV formula guard). */
  end: number;
  id: string;
  stage: Stage;
  applied: boolean;
}

export interface PreviewEdit {
  start: number;
  end: number;
  /** Replacement text in the output. */
  text: string;
  /** Applied changes that produced it (the top-level one first, nested ones after). */
  ids: string[];
  stage: Stage;
}

export interface Preview {
  marks: PreviewMark[];
  edits: PreviewEdit[];
}

/** Applied changes nested (inParent) under each change, recursively. */
function descendantsOf(changes: readonly Change[], applied: (c: Change) => boolean) {
  const kids = new Map<string, Change[]>();
  for (const c of changes) {
    if (c.anchor.kind !== 'inParent' || !applied(c)) continue;
    const list = kids.get(c.anchor.parentId) ?? [];
    list.push(c);
    kids.set(c.anchor.parentId, list);
  }
  return (id: string): string[] => {
    const out: string[] = [];
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length > 0) {
      const c = stack.shift()!;
      out.push(c.id);
      stack.push(...(kids.get(c.id) ?? []));
    }
    return out;
  };
}

export function preview(doc: Doc, changes: readonly Change[]): Preview {
  const byId = indexById(changes);
  const memo = new Map<string, boolean>();
  const applied = (c: Change) => isApplied(c, byId, memo);
  const nested = descendantsOf(changes, applied);
  const marks: PreviewMark[] = [];
  const edits: PreviewEdit[] = [];

  if (doc.format === 'text') {
    for (const c of changes) {
      if (c.anchor.kind !== 'original' || c.anchor.unit !== TEXT_UNIT) continue;
      const { start, end } = c.anchor;
      marks.push({ start, end, id: c.id, stage: c.stage, applied: applied(c) });
    }
    for (const e of appliedEdits(TEXT_UNIT, doc.text, changes).reverse()) {
      edits.push({
        start: e.start,
        end: e.end,
        text: e.output,
        ids: [e.change.id, ...nested(e.change.id)],
        stage: e.change.stage,
      });
    }
  } else {
    const cells = new Map<string, CsvCell>();
    for (const cell of doc.cells) cells.set(cellUnitId(cell.row, cell.column), cell);
    for (const c of changes) {
      if (c.anchor.kind !== 'original') continue;
      const cell = cells.get(c.anchor.unit);
      if (!cell) continue;
      marks.push({
        start: valueOffsetToSource(doc.source, cell, c.anchor.start),
        end: valueOffsetToSource(doc.source, cell, c.anchor.end, 'end'),
        id: c.id,
        stage: c.stage,
        applied: applied(c),
      });
    }
    for (const e of editedCells(doc, changes)) {
      const top = e.applied.filter((c) => c.anchor.kind === 'original');
      edits.push({
        start: e.cell.start,
        end: e.cell.end,
        text: e.raw,
        ids: e.applied.map((c) => c.id),
        stage: (top.find((c) => c.stage !== 'safety') ?? top[0] ?? e.applied[0]!).stage,
      });
    }
  }
  marks.sort((a, b) => a.start - b.start || a.end - b.end);
  return { marks, edits };
}
