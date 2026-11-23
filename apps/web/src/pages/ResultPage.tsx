/** Result view (PROJECT.md section 8): summary, warnings, before/after, change list, save. */
import type { Change, EncodingName, Stage } from '@cleanify/engine';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChangeList } from '../components/ChangeList';
import { DiffView, type JumpTarget } from '../components/DiffView';
import { ProgressBar } from '../components/ProgressBar';
import { SaveBar } from '../components/SaveBar';
import { StageIcon } from '../components/StageIcon';
import { WarningsPanel } from '../components/WarningsPanel';
import type { SourceInfo } from '../engine/protocol';
import { ENCODING_LABELS, STAGES, STAGE_ORDER, formatBytes, plural, summary } from '../lib/labels';
import { buildRows, rowAtOffset, rowAtOutLine } from '../lib/rows';
import { useSession } from '../session/SessionContext';

export function ResultPage() {
  const session = useSession();
  const { data, view } = session;
  const [jump, setJump] = useState<JumpTarget | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  useWarnBeforeLeaving(session.unsaved);

  const rows = useMemo(
    () => (data && view ? buildRows(data.original, view.marks, view.edits) : []),
    [data, view],
  );
  const markStart = useMemo(() => new Map(view?.marks.map((m) => [m.id, m.start]) ?? []), [view]);
  const byId = useMemo(() => new Map(data?.changes.map((c) => [c.id, c]) ?? []), [data]);

  const jumpToChange = useCallback(
    (id: string) => {
      // Nested changes have no mark of their own: use the top-level change they sit in.
      let c: Change | undefined = byId.get(id);
      while (c && c.anchor.kind === 'inParent') c = byId.get(c.anchor.parentId);
      const start = c ? markStart.get(c.id) : undefined;
      setFocusId(id);
      if (start !== undefined)
        setJump({ row: rowAtOffset(rows, start), id: c!.id, nonce: Date.now() });
    },
    [byId, markStart, rows],
  );

  if (!data || !view) {
    return (
      <div className="grid gap-3 py-16 text-center">
        <h1 className="text-2xl font-semibold">Nothing to show</h1>
        <p className="text-muted">
          Results live only in this browser tab, so they’re gone after a reload.
        </p>
        <p>
          <Link to="/" className="text-accent-text underline">
            Clean some text
          </Link>
        </p>
      </div>
    );
  }

  const counts: Partial<Record<Stage, number>> = {};
  data.changes.forEach((c, i) => {
    if (view.applied[i]) counts[c.stage] = (counts[c.stage] ?? 0) + 1;
  });
  const stagesPresent = STAGE_ORDER.filter((s) => data.changes.some((c) => c.stage === s));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"
          >
            <ArrowLeft aria-hidden="true" className="size-4" /> New text
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{data.source.name}</h1>
          <SourceMeta source={data.source} onPick={(e) => session.reanalyze(e)} />
        </div>
        <SaveBar
          source={data.source}
          exportNote={
            data.warnings.some((w) => w.kind === 'export-drops-parts')
              ? 'Heads-up: the downloaded workbook won’t have the charts or pivot tables listed below.'
              : undefined
          }
          suggested={data.suggestedEncoding}
          outputText={session.outputText}
          save={session.save}
        />
      </div>

      {session.progress && <ProgressBar progress={session.progress} onCancel={session.cancel} />}
      {session.error && (
        <p
          role="alert"
          className="rounded-lg border border-fix-invisible bg-fix-invisible-bg px-4 py-3 text-sm"
        >
          Something went wrong: {session.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="font-medium" aria-live="polite" data-testid="summary">
          {summary(counts)}
          {session.busy && <span className="ml-2 text-sm font-normal text-muted">updating…</span>}
        </p>
        {stagesPresent.length > 0 && (
          <ul aria-label="Highlight key" className="flex flex-wrap gap-3 text-xs">
            {stagesPresent.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <StageIcon stage={s} className="size-3.5" />
                <span className={`hl hl-${s} cursor-default px-1`}>{STAGES[s].label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WarningsPanel
        warnings={data.warnings}
        nonAscii={view.nonAscii}
        formulaRisks={view.formulaRisks}
        onJumpOutput={(line) => setJump({ row: rowAtOutLine(rows, line), nonce: Date.now() })}
        onJumpOriginal={(offset) => setJump({ row: rowAtOffset(rows, offset), nonce: Date.now() })}
      />

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <DiffView rows={rows} jump={jump} onSelect={setFocusId} />
        <ChangeList
          changes={data.changes}
          state={view}
          focusId={focusId}
          busy={session.busy}
          onDecide={session.decide}
          onJump={jumpToChange}
        />
      </div>
    </div>
  );
}

/**
 * Asks before a reload or closing the tab when the user has changed decisions that
 * aren't downloaded yet. Nothing is stored: results live only in this tab.
 */
function useWarnBeforeLeaving(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

const SHEET_LABEL: Record<string, string> = {
  xlsx: 'Excel workbook',
  xls: 'Excel 97–2003 workbook',
  ods: 'OpenDocument spreadsheet',
  accdb: 'Access database',
  mdb: 'Access database',
};

const CONFIDENCE: Record<string, string> = {
  high: 'sure',
  medium: 'fairly sure',
  low: 'not sure',
};

function SourceMeta({ source, onPick }: { source: SourceInfo; onPick: (e: EncodingName) => void }) {
  const id = useId();
  const isDb = source.sheetSource === 'accdb' || source.sheetSource === 'mdb';
  const parts = [
    source.sheetSource ? SHEET_LABEL[source.sheetSource] : source.format === 'csv' ? 'CSV' : 'Text',
    formatBytes(source.bytes),
    source.sheetCount !== null
      ? plural(source.sheetCount, isDb ? ['table', 'tables'] : ['sheet', 'sheets'])
      : null,
    source.delimiter
      ? `delimiter ${source.delimiter === '\t' ? 'tab' : `“${source.delimiter}”`}`
      : null,
  ].filter(Boolean);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span>{parts.join(' · ')}</span>
      {source.encoding && (
        <span className="flex items-center gap-1.5">
          <label htmlFor={id}>Encoding</label>
          <select
            id={id}
            value={source.encoding}
            onChange={(e) => onPick(e.target.value as EncodingName)}
            className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-text"
            aria-describedby={`${id}-why`}
          >
            {Object.entries(ENCODING_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span id={`${id}-why`} title={source.encodingReason ?? undefined}>
            {source.confidence ? `(${CONFIDENCE[source.confidence]})` : ''}
            <span className="sr-only">. {source.encodingReason}. Changing it starts over.</span>
          </span>
        </span>
      )}
    </div>
  );
}
