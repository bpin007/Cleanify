/**
 * Change list (PROJECT.md section 8, step 5): grouped by type, accept/reject per item
 * and per group, jump to location. Changes whose parent is rejected are greyed out.
 */
import type { Change, Stage } from '@cleanify/engine';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Crosshair } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeState, Decision } from '../engine/protocol';
import { STAGES, STAGE_ORDER, locationLabel } from '../lib/labels';
import { showInvisible } from '../lib/markers';
import { StageIcon } from './StageIcon';

type Item =
  | { type: 'group'; stage: Stage; total: number; applied: number }
  | { type: 'change'; index: number };

interface Props {
  changes: Change[];
  state: ChangeState;
  focusId: string | null;
  busy: boolean;
  onDecide: (d: Decision[]) => void;
  onJump: (id: string) => void;
}

const shown = (s: string, empty: string) => (s === '' ? empty : showInvisible(s));

export function ChangeList({ changes, state, focusId, busy, onDecide, onJump }: Props) {
  const [collapsed, setCollapsed] = useState<Set<Stage>>(new Set());

  const items = useMemo(() => {
    const byStage = new Map<Stage, number[]>();
    changes.forEach((c, i) => {
      const list = byStage.get(c.stage) ?? [];
      list.push(i);
      byStage.set(c.stage, list);
    });
    const out: Item[] = [];
    for (const stage of STAGE_ORDER) {
      const list = byStage.get(stage);
      if (!list) continue;
      out.push({
        type: 'group',
        stage,
        total: list.length,
        applied: list.filter((i) => state.applied[i]).length,
      });
      if (!collapsed.has(stage)) for (const index of list) out.push({ type: 'change', index });
    }
    return out;
  }, [changes, state.applied, collapsed]);

  const scroller = useRef<HTMLDivElement>(null);
  // No React Compiler here, so the virtualizer's unmemoizable API is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (items[i]!.type === 'group' ? 52 : 76),
    overscan: 12,
  });

  useEffect(() => {
    if (!focusId) return;
    const at = items.findIndex((it) => it.type === 'change' && changes[it.index]!.id === focusId);
    if (at >= 0) virtualizer.scrollToIndex(at, { align: 'center' });
  }, [focusId, items, changes, virtualizer]);

  if (changes.length === 0) {
    return (
      <section
        aria-label="Changes"
        className="grid place-items-center rounded-xl border border-border bg-surface p-8 text-center text-muted"
      >
        No changes needed with these settings.
      </section>
    );
  }

  return (
    <section
      aria-label="Changes"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <h2 className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
        Changes ({changes.length.toLocaleString('en')})
      </h2>
      <div ref={scroller} className="h-[65vh] min-h-80 overflow-auto" data-testid="change-list">
        <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index]!;
            return (
              <li
                key={v.key}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {item.type === 'group' ? (
                  <GroupHeader
                    item={item}
                    collapsed={collapsed.has(item.stage)}
                    busy={busy}
                    onToggle={() =>
                      setCollapsed((s) => {
                        const n = new Set(s);
                        if (n.has(item.stage)) n.delete(item.stage);
                        else n.add(item.stage);
                        return n;
                      })
                    }
                    onDecide={onDecide}
                  />
                ) : (
                  <ChangeRow
                    change={changes[item.index]!}
                    accepted={state.accepted[item.index]!}
                    applied={state.applied[item.index]!}
                    acceptable={state.acceptable[item.index]!}
                    focused={changes[item.index]!.id === focusId}
                    busy={busy}
                    onDecide={onDecide}
                    onJump={onJump}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function GroupHeader({
  item,
  collapsed,
  busy,
  onToggle,
  onDecide,
}: {
  item: Extract<Item, { type: 'group' }>;
  collapsed: boolean;
  busy: boolean;
  onToggle: () => void;
  onDecide: (d: Decision[]) => void;
}) {
  const meta = STAGES[item.stage];
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-2 rounded text-left"
      >
        <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <StageIcon stage={item.stage} />
        <span className="truncate font-medium">{meta.label}</span>
        <span className="shrink-0 text-xs text-muted">
          {item.applied.toLocaleString('en')} of {item.total.toLocaleString('en')} applied
        </span>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onDecide([{ type: 'group', stage: item.stage, accepted: true }])}
        className="rounded-md px-2 py-1 text-xs font-medium text-accent-text hover:bg-accent-bg disabled:opacity-50"
        aria-label={`Accept all ${meta.label.toLowerCase()}`}
      >
        Accept all
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onDecide([{ type: 'group', stage: item.stage, accepted: false }])}
        className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-text disabled:opacity-50"
        aria-label={`Reject all ${meta.label.toLowerCase()}`}
      >
        Reject all
      </button>
    </div>
  );
}

function ChangeRow({
  change: c,
  accepted,
  applied,
  acceptable,
  focused,
  busy,
  onDecide,
  onJump,
}: {
  change: Change;
  accepted: boolean;
  applied: boolean;
  acceptable: boolean;
  focused: boolean;
  busy: boolean;
  onDecide: (d: Decision[]) => void;
  onJump: (id: string) => void;
}) {
  const where = locationLabel(c.location);
  const from = shown(c.from, '(nothing)');
  const to = shown(c.to, '(removed)');
  const waiting = !acceptable;
  return (
    <div
      className={
        'flex gap-3 border-b border-border px-3 py-2.5 ' +
        (focused ? 'bg-accent-bg ' : '') +
        (waiting ? 'opacity-55' : '')
      }
      data-change-id={c.id}
    >
      <input
        type="checkbox"
        checked={accepted && !waiting}
        disabled={busy || waiting}
        onChange={(e) => onDecide([{ type: 'one', id: c.id, accepted: e.target.checked }])}
        aria-label={`Apply ${STAGES[c.stage].noun[0]} ${from} to ${to}, ${where}`}
        className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-sm">
          <span className={applied ? 'line-through decoration-muted' : ''}>{from}</span>
          <span aria-hidden="true" className="text-muted">
            →
          </span>
          <span className={applied ? 'font-semibold' : 'text-muted'}>{to}</span>
          {c.confidence !== 'high' && (
            <span className="rounded-full border border-border px-1.5 font-sans text-xs text-muted">
              {c.confidence} confidence
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {waiting ? 'Needs the encoding repair it sits in, which is rejected. ' : ''}
          {c.reason}
        </p>
        <button
          type="button"
          onClick={() => onJump(c.id)}
          className="mt-1 inline-flex items-center gap-1 rounded text-xs text-accent-text hover:underline"
        >
          <Crosshair aria-hidden="true" className="size-3" />
          {where}
        </button>
      </div>
    </div>
  );
}
