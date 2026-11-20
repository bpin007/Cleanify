/**
 * Public engine types — PROJECT.md section 13.
 *
 * Offsets (`start`, `end`, `offsetInParent`, text `offset`) are UTF-16 code-unit
 * offsets, for fast slicing. Human-facing columns (`column`, `charPos`) are
 * 1-based and counted in code points (section 19 #15).
 */

export type Stage = 'encoding' | 'ascii' | 'invisible' | 'translate';
export type Confidence = 'high' | 'medium' | 'low';

/** Machine position (decision D3). */
export type Anchor =
  | { kind: 'original'; unit: string; start: number; end: number }
  | { kind: 'inParent'; parentId: string; offsetInParent: number; length: number };

/** Where to show a change to the user. Always points into the ORIGINAL text. */
export type Location =
  | { type: 'text'; line: number; column: number; offset: number }
  | { type: 'csv'; row: number; column: number; header?: string; charPos: number }
  | { type: 'sheet'; sheet: string; cell: string; charPos: number };

export interface Change {
  id: string;
  stage: Stage;
  /** e.g. 'mojibake', 'bom', 'accent', 'nbsp', 'zwsp', 'tag-char', 'smart-quote', 'control' */
  kind: string;
  /** Original text of the change (for `inParent` changes: text inside the parent's `to`). */
  from: string;
  /** Proposed replacement ('' = remove). */
  to: string;
  reason: string;
  confidence: Confidence;
  anchor: Anchor;
  location: Location;
  /** The user's own decision. Whether it is applied also depends on its parents (see `isApplied`). */
  accepted: boolean;
  dependsOn?: string[];
}

export type Severity = 'info' | 'warning' | 'high';

export type WarningKind =
  | 'data-lost' // U+FFFD present: damage already done (#8)
  | 'double-bom' // more than one BOM at the start (#9)
  | 'hidden-text' // Unicode tag characters (#6)
  | 'bidi-control' // direction overrides / isolates
  | 'mixed-script' // look-alike letters, e.g. Cyrillic а in "pаypal" (#10)
  | 'unterminated-quote' // CSV quote never closed (#17)
  | 'low-confidence-encoding' // encoding guess is uncertain (#18)
  | 'whole-file-mojibake'; // most of the file looks garbled

export interface EngineWarning {
  kind: WarningKind;
  severity: Severity;
  message: string;
  location?: Location;
}

export type EncodingName =
  'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be' | 'windows-1252' | 'shift_jis';

export interface EncodingResult {
  encoding: EncodingName;
  /** Number of BOMs at the very start of the bytes (0, 1, or more if doubled). */
  bomCount: number;
  confidence: Confidence;
  /** Human-readable explanation of how the encoding was chosen. */
  reason: string;
}

export interface DecodedDoc {
  /** Decoded text. Exactly one leading BOM is removed; any extra BOMs stay as U+FEFF. */
  text: string;
  encoding: EncodingName;
  bomCount: number;
  confidence: Confidence;
  warnings: EngineWarning[];
}

/** One piece of text the pipeline works on: the whole text, or one CSV cell. */
export interface Unit {
  id: string;
  text: string;
}

export interface TextDoc {
  format: 'text';
  text: string;
}

export interface CsvCell {
  /** 1-based row and column. */
  row: number;
  column: number;
  /** Unescaped value. */
  value: string;
  quoted: boolean;
  /** Raw span in `source` (includes the quotes when quoted). */
  start: number;
  end: number;
}

export interface CsvDoc {
  format: 'csv';
  source: string;
  delimiter: string;
  hasHeader: boolean;
  cells: CsvCell[];
  rowCount: number;
  warnings: EngineWarning[];
}

export type Doc = TextDoc | CsvDoc;

export interface AsciiOptions {
  /** « » → `<< >>` ('angle', default) or `"` ('quote'). */
  guillemets?: 'angle' | 'quote';
  /** Emoji: keep (default), remove, or replace common ones with text like `:D`. */
  emoji?: 'keep' | 'remove' | 'text';
  /** Non-Latin scripts: leave as is (default) or transliterate (`Москва → Moskva`). */
  nonLatin?: 'keep' | 'transliterate';
}

export interface PipelineOptions {
  stages?: {
    /** Stage 1 — repair mojibake. Default on. */
    encoding?: boolean;
    /** Stage 2 — accents → ASCII plus invisible/control cleanup. Default off. */
    ascii?: boolean;
  };
  ascii?: AsciiOptions;
}

export interface AnalysisResult {
  changes: Change[];
  warnings: EngineWarning[];
}

export interface SerializeOptions {
  /** Output encoding. Default: the input's encoding for decoded docs, else UTF-8. */
  encoding?: EncodingName;
  /** Number of BOMs to write at the start. Default 0. */
  bomCount?: number;
}
