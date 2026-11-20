/**
 * @cleanify/engine — public entry point (PROJECT.md section 13).
 */
import type {
  AnalysisResult,
  Change,
  CsvDoc,
  DecodedDoc,
  Doc,
  EncodingName,
  EncodingResult,
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

export function detectEncoding(_bytes: Uint8Array): EncodingResult {
  throw new NotImplementedError('detectEncoding');
}

export function decode(_bytes: Uint8Array, _encoding?: EncodingName): DecodedDoc {
  throw new NotImplementedError('decode');
}

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
