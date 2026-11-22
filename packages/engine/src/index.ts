/**
 * @cleanify/engine — public entry point (PROJECT.md section 13).
 */
import { encodeText } from './charsets/encode';
import { applyText, textUnits } from './formats/text';
import { analyzeUnits } from './pipeline/analyze';
import type {
  AnalysisResult,
  Change,
  CsvDoc,
  Doc,
  PipelineOptions,
  SerializeOptions,
} from './types';

export type * from './types';

export const ENGINE_VERSION = '0.1.0';

class NotImplementedError extends Error {
  constructor(name: string) {
    super(`${name} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

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
export {
  ChangeModelError,
  appliedIds,
  canAccept,
  isApplied,
  setDecision,
  setGroupDecision,
  validateChanges,
} from './changes/model';

export function parseCsv(
  _source: string,
  _options?: { delimiter?: string; hasHeader?: boolean },
): CsvDoc {
  throw new NotImplementedError('parseCsv');
}

/** Proposes changes for a document (Stage 1, Stage 2 and warnings). */
export function analyze(doc: Doc, options: PipelineOptions = {}): AnalysisResult {
  if (doc.format === 'text') return analyzeUnits(textUnits(doc), options);
  throw new NotImplementedError('analyze (csv)');
}

/** Applies the accepted changes (respecting dependsOn) and returns the new document. */
export function applyChanges(doc: Doc, changes: readonly Change[]): Doc {
  if (doc.format === 'text') return applyText(doc, changes);
  throw new NotImplementedError('applyChanges (csv)');
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
