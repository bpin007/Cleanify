/**
 * Virtualized before/after view (PROJECT.md section 9: diff viewer). Rows are
 * original lines; highlights carry the change type in colour, underline style and
 * an accessible label.
 */
import type { Stage } from '@cleanify/engine';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useRef } from 'react';
import { STAGES } from '../lib/labels';
import { withMarkers } from '../lib/markers';
import type { Row, Seg } from '../lib/rows';

export interface JumpTarget {
  row: number;
  /** Change to outline, if any. */
  id?: string;
  /** Changes on every jump, so jumping to the same row twice still scrolls. */
  nonce: number;
}

function Text({ text }: { text: string }) {
  return (
    <>
      {withMarkers(text).map((p, i) =>
        p.marker ? (
          <span key={i} className="ws-marker" title={p.title}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const typeName = (stage: Stage) => STAGES[stage].noun[0];

function Segment({
  seg,
  flashId,
  onSelect,
}: {
  seg: Seg;
  flashId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (seg.kind === 'plain') return <Text text={seg.text} />;
  const id = seg.kind === 'mark' ? seg.id : seg.ids[0]!;
  const on = seg.kind === 'edit' || seg.applied;
  const label =
    seg.kind === 'mark'
      ? `${typeName(seg.stage)}${seg.applied ? '' : ' (rejected)'}`
      : `${typeName(seg.stage)}, result`;
  const cls = [
    'hl',
    on ? `hl-${seg.stage}` : 'hl-off',
    seg.text === '' ? 'hl-point' : '',
    flashId && (seg.kind === 'mark' ? seg.id === flashId : seg.ids.includes(flashId))
      ? 'hl-flash'
      : '',
  ].join(' ');
  return (
    <mark
      className={cls}
      title={label}
      aria-label={`${label}: ${seg.text || 'nothing'}`}
      onClick={() => onSelect(id)}
    >
      <Text text={seg.text} />
    </mark>
  );
}

const RowView = memo(function RowView({
  row,
  flashId,
  onSelect,
}: {
  row: Row;
  flashId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const changed =
    row.after.some((s) => s.kind === 'edit') || row.before.some((s) => s.kind === 'mark');
  return (
    <div className={'grid grid-cols-[3.25rem_1fr_1fr] ' + (changed ? 'bg-surface-2/60' : '')}>
      <div className="select-none px-2 py-0.5 text-right text-xs leading-6 text-muted">
        {row.line}
      </div>
      <div className="border-l border-border px-3 py-0.5 leading-6 whitespace-pre-wrap break-words">
        {row.before.map((s, i) => (
          <Segment key={i} seg={s} flashId={flashId} onSelect={onSelect} />
        ))}
      </div>
      <div className="border-l border-border px-3 py-0.5 leading-6 whitespace-pre-wrap break-words">
        {row.after.map((s, i) => (
          <Segment key={i} seg={s} flashId={flashId} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
});

export function DiffView({
  rows,
  jump,
  onSelect,
}: {
  rows: Row[];
  jump: JumpTarget | null;
  onSelect: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // No React Compiler here, so the virtualizer's unmemoizable API is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 26,
    overscan: 20,
  });

  useEffect(() => {
    if (jump) virtualizer.scrollToIndex(jump.row, { align: 'center' });
  }, [jump, virtualizer]);

  return (
    <section
      aria-label="Before and after"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="grid grid-cols-[3.25rem_1fr_1fr] border-b border-border text-xs font-medium uppercase tracking-wide text-muted">
        <span className="px-2 py-2 text-right">Line</span>
        <span className="border-l border-border px-3 py-2">Before</span>
        <span className="border-l border-border px-3 py-2">After</span>
      </div>
      <div
        ref={scroller}
        data-testid="diff-scroller"
        className="max-h-[65vh] min-h-24 overflow-auto font-mono text-sm"
        style={{ height: virtualizer.getTotalSize() }}
        tabIndex={0}
        aria-label="Before and after text, scrollable"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              <RowView
                row={rows[v.index]!}
                flashId={jump && jump.row === v.index ? jump.id : undefined}
                onSelect={onSelect}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
