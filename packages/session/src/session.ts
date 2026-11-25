/**
 * The engine session that runs inside the Web Worker. Kept free of worker globals so
 * it can be unit-tested in Node.
 */
import {
  UnencodableError,
  analyze,
  applyChanges,
  decode,
  detectEncoding,
  indexById,
  isApplied,
  overriddenBy,
  loadIconvEncoder,
  loadTransliterator,
  parseCsv,
  parseText,
  preview,
  readWorkbook,
  render,
  renderSheet,
  serialize,
  sheetSourceOf,
  setDecision,
  setGroupDecision,
  suggestOutputEncoding,
  writeWorkbook,
  type AppliedDoc,
  type Change,
  type Doc,
  type EncodingName,
  type EngineWarning,
  type ExternalEncoder,
  type Location,
  type PipelineOptions,
  type RemainingChar,
} from '@cleanify/engine';
import type {
  AnalyzedData,
  ChangeState,
  CleanInput,
  CleanSettings,
  Decision,
  ReportItem,
  SourceInfo,
  UnencodableItem,
  ViewData,
} from './protocol';

export type Progress = (phase: string, fraction: number) => void;

/** Fast offset → 1-based line lookups for one text. */
export function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export class EngineSession {
  private bytes: Uint8Array | null = null;
  private source: SourceInfo | null = null;
  private doc: Doc | null = null;
  private changes: Change[] = [];
  private options: PipelineOptions = {};
  /** Options for the output report: no "still not ASCII" list when only invisible characters are cleaned. */
  private reportOptions: PipelineOptions = {};
  private output: AppliedDoc | null = null;
  private warnings: EngineWarning[] = [];
  private iconv: Promise<ExternalEncoder> | null = null;

  async analyze(input: CleanInput, settings: CleanSettings, progress: Progress) {
    progress('Reading', 0.02);
    if (input.kind === 'paste') {
      this.bytes = null;
      this.source = {
        name: 'Pasted text',
        format: 'text',
        encoding: null,
        bomCount: 0,
        confidence: null,
        encodingReason: null,
        delimiter: null,
        bytes: input.text.length,
        sheetSource: null,
        sheetCount: null,
      };
      return this.run(parseText(input.text), [], settings, progress);
    }
    this.bytes = new Uint8Array(input.bytes);
    this.source = {
      name: input.name,
      format: input.format,
      encoding: null,
      bomCount: 0,
      confidence: null,
      encodingReason: null,
      delimiter: null,
      bytes: this.bytes.length,
      sheetSource: null,
      sheetCount: null,
    };
    if (input.format === 'sheet') {
      const kind = sheetSourceOf(input.name);
      if (!kind) throw new Error(`${input.name} is not a workbook this tool can read`);
      progress(
        kind === 'accdb' || kind === 'mdb' ? 'Reading the database' : 'Reading the workbook',
        0.05,
      );
      const doc = await readWorkbook(this.bytes, kind);
      this.source.sheetSource = kind;
      this.source.sheetCount = doc.sheets.length;
      return this.run(doc, [], settings, progress);
    }
    return this.decodeAndRun(undefined, settings, progress);
  }

  /** Runs again with an encoding the user picked (decision D9). Decisions are reset. */
  async reanalyze(encoding: EncodingName, settings: CleanSettings, progress: Progress) {
    if (!this.bytes || !this.source || this.source.format === 'sheet')
      throw new Error('Only text and CSV files can be read with another encoding');
    return this.decodeAndRun(encoding, settings, progress);
  }

  private async decodeAndRun(
    encoding: EncodingName | undefined,
    settings: CleanSettings,
    progress: Progress,
  ) {
    progress('Detecting the encoding', 0.05);
    const detected = detectEncoding(this.bytes!);
    const decoded = decode(this.bytes!, encoding);
    this.source = {
      ...this.source!,
      encoding: decoded.encoding,
      bomCount: decoded.bomCount,
      confidence: decoded.confidence,
      encodingReason: encoding ? 'Chosen by you' : detected.reason,
    };
    progress('Reading the structure', 0.1);
    const doc = this.source.format === 'csv' ? parseCsv(decoded.text) : parseText(decoded.text);
    if (doc.format === 'csv') this.source.delimiter = doc.delimiter;
    return this.run(doc, decoded.warnings, settings, progress);
  }

  private async run(
    doc: Doc,
    decodeWarnings: EngineWarning[],
    settings: CleanSettings,
    progress: Progress,
  ): Promise<AnalyzedData> {
    this.doc = doc;

    const ascii = { ...settings.asciiOptions };
    if (settings.ascii && settings.asciiOptions.nonLatin === 'transliterate') {
      progress('Loading the transliterator', 0.15);
      Object.assign(ascii, { transliterate: await loadTransliterator() });
    }
    this.options = { stages: { encoding: settings.repair, ascii: settings.ascii }, ascii };
    if (settings.rules) this.options.rules = settings.rules;
    const invisibleOnly = settings.ascii && settings.asciiScope === 'invisible';
    this.reportOptions = invisibleOnly
      ? { ...this.options, stages: { encoding: settings.repair, ascii: false } }
      : this.options;

    let last = 0;
    const result = analyze(this.doc, this.options, {
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last < 50 && done < total) return;
        last = now;
        progress('Finding changes', 0.2 + 0.7 * (total === 0 ? 1 : done / total));
      },
    });
    // Invisible-only: drop accent/symbol proposals. Nothing depends on them (Stage 2
    // changes only ever depend on Stage 1 repairs), so the rest stays consistent.
    this.changes = invisibleOnly
      ? result.changes.filter((c) => c.stage !== 'ascii')
      : result.changes;
    this.warnings = [...decodeWarnings, ...result.warnings];
    progress('Preparing the preview', 0.92);
    const data = this.current();
    progress('Done', 1);
    return data;
  }

  /** The whole result as it stands now, decisions included (the API's cloud jobs use it). */
  current(): AnalyzedData {
    if (!this.doc || !this.source) throw new Error('Nothing analysed yet');
    return {
      ...this.view(),
      source: this.source,
      original: render(this.doc),
      changes: this.changes,
      warnings: this.warnings,
      suggestedEncoding: this.suggestedEncoding(),
    };
  }

  private suggestedEncoding(): EncodingName {
    if (this.doc?.format === 'sheet') return 'utf-8';
    const input = this.source?.encoding ?? 'utf-8';
    const { applied: isOn } = this.state();
    const applied = this.changes.filter((_, i) => isOn[i]);
    return suggestOutputEncoding(input, applied);
  }

  decide(decisions: readonly Decision[]): ViewData {
    for (const d of decisions) {
      if (d.type === 'one') this.changes = setDecision(this.changes, d.id, d.accepted);
      else {
        this.changes = setGroupDecision(
          this.changes,
          (c) => c.stage === d.stage && (d.kind === undefined || c.kind === d.kind),
          d.accepted,
        );
      }
    }
    return this.view();
  }

  private state(): ChangeState {
    const byId = indexById(this.changes);
    const memo = new Map<string, boolean>();
    const overridden = overriddenBy(this.changes);
    const applied = this.changes.map((c) => isApplied(c, byId, memo) && !overridden.has(c.id));
    const acceptable = this.changes.map((c) =>
      (c.dependsOn ?? []).every((pid) => {
        const p = byId.get(pid);
        return p !== undefined && isApplied(p, byId, memo);
      }),
    );
    return {
      accepted: this.changes.map((c) => c.accepted),
      applied,
      overriddenBy: this.changes.map((c) => overridden.get(c.id) ?? null),
      acceptable,
    };
  }

  private view(): ViewData {
    const doc = this.doc!;
    this.output = applyChanges(doc, this.changes, this.reportOptions);
    const out = this.output;
    const p = preview(doc, this.changes);
    const outLine = this.outLineLookup();
    const item = (n: Pick<RemainingChar, 'location'> & Partial<RemainingChar>): ReportItem => {
      const r: ReportItem = { location: n.location, outLine: outLine(n.location) };
      if (n.char !== undefined) r.char = n.char;
      if (n.codePoint !== undefined) r.codePoint = n.codePoint;
      return r;
    };
    return {
      ...this.state(),
      marks: p.marks,
      edits: p.edits,
      nonAscii: out.report.nonAscii.map(item),
      formulaRisks: out.report.formulaRisks.map((location) => item({ location })),
      outputLength: render(out).length,
    };
  }

  /** Output line of a report location, so the UI can scroll to it. */
  private outLineLookup(): (loc: Location) => number {
    const out = this.output!;
    if (out.format === 'sheet') {
      const { text, valueStarts } = renderSheet(out);
      const line = lineIndex(text);
      const starts = new Map<string, number>();
      out.cells.forEach((c, i) => starts.set(`${c.sheet}!${c.address}`, valueStarts[i]!));
      return (loc) => {
        if (loc.type !== 'sheet') return 1;
        const start = starts.get(`${loc.sheet}!${loc.cell}`);
        return start === undefined ? 1 : line(start);
      };
    }
    if (out.format !== 'csv') return (loc) => (loc.type === 'text' ? loc.line : 1);
    const line = lineIndex(out.source);
    const starts = new Map<string, number>();
    for (const c of out.cells) starts.set(`${c.row}:${c.column}`, c.start);
    return (loc) => {
      if (loc.type !== 'csv') return 1;
      const start = starts.get(`${loc.row}:${loc.column}`);
      return start === undefined ? 1 : line(start);
    };
  }

  outputText(): string {
    return render(this.output!);
  }

  /** Workbooks are written as .xlsx (encoding ignored); Shift-JIS loads iconv-lite first. */
  async serialize(
    encoding: EncodingName,
    bomCount: number,
  ): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; chars: UnencodableItem[] }> {
    const out = this.output!;
    if (out.format === 'sheet') return { ok: true, bytes: await writeWorkbook(out) };
    try {
      const encoder =
        encoding === 'shift_jis' ? await (this.iconv ??= loadIconvEncoder()) : undefined;
      return {
        ok: true,
        bytes: serialize(out, encoder ? { encoding, bomCount, encoder } : { encoding, bomCount }),
      };
    } catch (e) {
      if (!(e instanceof UnencodableError)) throw e;
      const text = this.outputText();
      const line = lineIndex(text);
      return {
        ok: false,
        chars: e.chars.slice(0, 500).map((c) => {
          const l = line(c.offset);
          const lineStart = l === 1 ? 0 : text.lastIndexOf('\n', c.offset - 1) + 1;
          return { char: c.char, line: l, column: [...text.slice(lineStart, c.offset)].length + 1 };
        }),
      };
    }
  }
}
