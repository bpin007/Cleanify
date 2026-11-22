/**
 * @cleanify/engine — public entry point (PROJECT.md section 13).
 */
import { encodeText } from './charsets/encode';
import { applyCsv, csvUnits, formulaGuard } from './formats/csv';
import { applyText, textUnits } from './formats/text';
import { analyzeUnits } from './pipeline/analyze';
import type {
  AnalysisResult,
  Change,
  Doc,
  EncodingName,
  PipelineOptions,
  SerializeOptions,
} from './types';

export type * from './types';

export const ENGINE_VERSION = '0.1.0';

/**
 * Loads the transliterator (any-ascii, decision D7) only when the user turns
 * transliteration on, so its ~220 KB never weighs on the first page load.
 */
export async function loadTransliterator(): Promise<(text: string) => string> {
  const mod = await import('any-ascii');
  return mod.default;
}

export { detectEncoding } from './decode/detect';
export { decode } from './decode/decode';
export { encodeText, UnencodableError } from './charsets/encode';
export type { ExternalEncoder, UnencodableChar } from './charsets/encode';
export { parseText } from './formats/text';
export { parseCsv, detectDelimiter } from './formats/csv';
export type { CsvOptions } from './formats/csv';
export {
  ChangeModelError,
  appliedIds,
  canAccept,
  isApplied,
  setDecision,
  setGroupDecision,
  validateChanges,
} from './changes/model';

/** Proposes changes for a document (Stage 1, Stage 2, the CSV formula guard, and warnings). */
export function analyze(doc: Doc, options: PipelineOptions = {}): AnalysisResult {
  if (doc.format === 'text') return analyzeUnits(textUnits(doc), options);
  const guard = options.safety?.formulaGuard ?? true;
  const result = analyzeUnits(csvUnits(doc), options, {
    ...(guard
      ? {
          extraProposals: (unit) => {
            const p = formulaGuard(unit.text);
            return p ? [p] : [];
          },
        }
      : {}),
  });
  return { changes: result.changes, warnings: [...doc.warnings, ...result.warnings] };
}

/** Applies the accepted changes (respecting dependsOn) and returns the new document. */
export function applyChanges(doc: Doc, changes: readonly Change[]): Doc {
  return doc.format === 'text' ? applyText(doc, changes) : applyCsv(doc, changes);
}

/** The document's text (CSV: the full file text). */
export function render(doc: Doc): string {
  return doc.format === 'text' ? doc.text : doc.source;
}

/** Encodes the document to bytes, with the requested encoding and BOMs (default UTF-8, no BOM). */
export function serialize(doc: Doc, options: SerializeOptions = {}): Uint8Array {
  return encodeText(
    render(doc),
    options.encoding ?? 'utf-8',
    options.bomCount ?? 0,
    options.encoder,
  );
}

/**
 * Default output encoding (decision D1): UTF-8 if any Stage 1 repair is applied
 * (the repaired text often no longer fits the old encoding), otherwise the
 * input's own encoding.
 */
export function suggestOutputEncoding(
  inputEncoding: EncodingName,
  appliedChanges: readonly Change[],
): EncodingName {
  return appliedChanges.some((c) => c.stage === 'encoding') ? 'utf-8' : inputEncoding;
}
