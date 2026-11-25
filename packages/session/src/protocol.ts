/**
 * Messages between the UI and the engine Web Worker (PROJECT.md section 8, main flow
 * step 3). The worker keeps the document, its bytes and the changes; the UI gets
 * plain data back, so the engine never runs on the main thread.
 */
import type {
  AsciiOptions,
  RuleSet,
  Change,
  Confidence,
  EncodingName,
  EngineWarning,
  Location,
  PreviewEdit,
  PreviewMark,
  SheetSource,
  Stage,
} from '@cleanify/engine';

/** 'sheet' = Excel, OpenDocument or Access (saved as .xlsx). */
export type InputFormat = 'text' | 'csv' | 'sheet';

export type CleanInput =
  | { kind: 'paste'; text: string }
  | { kind: 'file'; name: string; bytes: ArrayBuffer; format: InputFormat };

export interface CleanSettings {
  repair: boolean;
  ascii: boolean;
  /**
   * What the ASCII step changes: everything (accents, symbols, invisible characters), or
   * only invisible and control characters (the "remove invisible characters" tool).
   */
  asciiScope: 'all' | 'invisible';
  asciiOptions: Pick<AsciiOptions, 'emoji' | 'nonLatin' | 'guillemets'>;
  /**
   * The user's own rules (section 5): saved ones for signed-in users (loaded by the
   * API for cloud jobs, fetched by the web app for browser mode), session-only ones
   * for anonymous users.
   */
  rules?: RuleSet | undefined;
}

/** A report item with the 1-based line in the output where it sits, for jumping. */
export interface ReportItem {
  location: Location;
  outLine: number;
  char?: string;
  codePoint?: number;
}

export interface ChangeState {
  accepted: boolean[];
  /** In the output: accepted, parents applied, and not overridden by one of the user's rules. */
  applied: boolean[];
  /** The id of the user's rule that replaces this accepted change, if any. */
  overriddenBy: (string | null)[];
  /** False when a parent change is rejected, so this one can't be accepted. */
  acceptable: boolean[];
}

export interface ViewData extends ChangeState {
  marks: PreviewMark[];
  edits: PreviewEdit[];
  nonAscii: ReportItem[];
  formulaRisks: ReportItem[];
  outputLength: number;
}

export interface SourceInfo {
  name: string;
  format: InputFormat;
  /** null for pasted text. */
  encoding: EncodingName | null;
  bomCount: number;
  confidence: Confidence | null;
  encodingReason: string | null;
  delimiter: string | null;
  bytes: number;
  /** Workbooks only: which kind of file it was. */
  sheetSource: SheetSource | null;
  /** Workbooks only: number of sheets. */
  sheetCount: number | null;
}

export interface AnalyzedData extends ViewData {
  source: SourceInfo;
  original: string;
  changes: Change[];
  warnings: EngineWarning[];
  suggestedEncoding: EncodingName;
}

export type Decision =
  | { type: 'one'; id: string; accepted: boolean }
  | { type: 'group'; stage: Stage; kind?: string; accepted: boolean };

export type ToWorker =
  | { type: 'analyze'; job: number; input: CleanInput; settings: CleanSettings }
  | { type: 'reanalyze'; job: number; encoding: EncodingName; settings: CleanSettings }
  | { type: 'decide'; job: number; decisions: Decision[] }
  | { type: 'output'; job: number }
  | { type: 'serialize'; job: number; encoding: EncodingName; bomCount: number };

export interface UnencodableItem {
  char: string;
  line: number;
  column: number;
}

export type FromWorker =
  | { type: 'progress'; job: number; phase: string; fraction: number }
  | { type: 'analyzed'; job: number; data: AnalyzedData }
  | { type: 'decided'; job: number; data: ViewData }
  | { type: 'output'; job: number; text: string }
  | { type: 'serialized'; job: number; bytes: Uint8Array }
  | { type: 'unencodable'; job: number; encoding: EncodingName; chars: UnencodableItem[] }
  | { type: 'error'; job: number; message: string };
