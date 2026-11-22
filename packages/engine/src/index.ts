/**
 * @cleanify/engine — public entry point (PROJECT.md section 13).
 */
import type {
  AnalysisResult,
  Change,
  CsvDoc,
  Doc,
  PipelineOptions,
  SerializeOptions,
  TextDoc,
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

export function parseText(_text: string): TextDoc {
  throw new NotImplementedError('parseText');
}

export function parseCsv(
  _source: string,
  _options?: { delimiter?: string; hasHeader?: boolean },
): CsvDoc {
  throw new NotImplementedError('parseCsv');
}

export function analyze(_doc: Doc, _options?: PipelineOptions): AnalysisResult {
  throw new NotImplementedError('analyze');
}

export function applyChanges(_doc: Doc, _changes: readonly Change[]): Doc {
  throw new NotImplementedError('applyChanges');
}

/** The document's text after any changes (CSV: the full file text). */
export function render(_doc: Doc): string {
  throw new NotImplementedError('render');
}

export function serialize(_doc: Doc, _options?: SerializeOptions): Uint8Array {
  throw new NotImplementedError('serialize');
}
