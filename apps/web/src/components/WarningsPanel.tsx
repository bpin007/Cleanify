/**
 * Warnings: the engine's (data lost, hidden text, encoding guesses…) plus the output
 * report: characters still not ASCII and cells that could still run as formulas.
 */
import type { EngineWarning } from '@cleanify/engine';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { ReportItem } from '../engine/protocol';
import { locationLabel, plural } from '../lib/labels';
import { showInvisible } from '../lib/markers';

interface Props {
  warnings: EngineWarning[];
  nonAscii: ReportItem[];
  formulaRisks: ReportItem[];
  onJumpOutput: (outLine: number) => void;
  onJumpOriginal: (offset: number) => void;
}

const ICON = { info: Info, warning: TriangleAlert, high: CircleAlert };

function Card(props: { severity: EngineWarning['severity']; children: ReactNode }) {
  const Icon = ICON[props.severity];
  const tone =
    props.severity === 'info'
      ? 'border-border bg-surface'
      : props.severity === 'warning'
        ? 'border-fix-encoding bg-fix-encoding-bg'
        : 'border-fix-invisible bg-fix-invisible-bg';
  return (
    <li className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{props.children}</div>
    </li>
  );
}

const MAX_LINKS = 8;

export function WarningsPanel({
  warnings,
  nonAscii,
  formulaRisks,
  onJumpOutput,
  onJumpOriginal,
}: Props) {
  const byChar = useMemo(() => {
    const m = new Map<string, { codePoint: number; items: ReportItem[] }>();
    for (const n of nonAscii) {
      const e = m.get(n.char!) ?? { codePoint: n.codePoint!, items: [] };
      e.items.push(n);
      m.set(n.char!, e);
    }
    return [...m.entries()].sort((a, b) => b[1].items.length - a[1].items.length);
  }, [nonAscii]);

  if (warnings.length === 0 && nonAscii.length === 0 && formulaRisks.length === 0) return null;

  return (
    <ul aria-label="Warnings" className="grid gap-2">
      {warnings.map((w, i) => (
        <Card key={i} severity={w.severity}>
          <p>{w.message}</p>
          {w.location && (
            <p className="mt-1 text-xs">
              {w.location.type === 'text' ? (
                <button
                  type="button"
                  className="text-accent-text hover:underline"
                  onClick={() => onJumpOriginal((w.location as { offset: number }).offset)}
                >
                  {locationLabel(w.location)}
                </button>
              ) : (
                <span className="text-muted">{locationLabel(w.location)}</span>
              )}
            </p>
          )}
        </Card>
      ))}

      {nonAscii.length > 0 && (
        <Card severity="warning">
          <p className="font-medium" data-testid="still-not-ascii">
            {plural(nonAscii.length, ['character is', 'characters are'])} still not ASCII
          </p>
          <p className="text-xs">
            For example rejected repairs, other alphabets you chose to keep, or emoji. Accept more
            changes, or change the options and clean again.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium">
              Show the {plural(byChar.length, ['different character', 'different characters'])}
            </summary>
            <ul className="mt-2 grid gap-1.5">
              {byChar.map(([char, { codePoint, items }]) => (
                <li key={char} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="rounded bg-surface px-1.5 font-mono text-sm">
                    {showInvisible(char)}
                  </span>
                  <span className="text-muted">
                    U+{codePoint.toString(16).toUpperCase().padStart(4, '0')} ×{items.length}
                  </span>
                  {items.slice(0, MAX_LINKS).map((it, k) => (
                    <button
                      key={k}
                      type="button"
                      className="text-accent-text hover:underline"
                      onClick={() => onJumpOutput(it.outLine)}
                    >
                      {locationLabel(it.location)}
                    </button>
                  ))}
                  {items.length > MAX_LINKS && (
                    <span className="text-muted">and {items.length - MAX_LINKS} more</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {formulaRisks.length > 0 && (
        <Card severity="high">
          <p className="font-medium">
            {plural(formulaRisks.length, ['cell', 'cells'])} could run as a formula in a spreadsheet
            app
          </p>
          <p className="text-xs">
            Accept the spreadsheet safety changes to add an apostrophe in front.{' '}
            {formulaRisks.slice(0, MAX_LINKS).map((r, k) => (
              <button
                key={k}
                type="button"
                className="mr-2 text-accent-text hover:underline"
                onClick={() => onJumpOutput(r.outLine)}
              >
                {locationLabel(r.location)}
              </button>
            ))}
          </p>
        </Card>
      )}
    </ul>
  );
}
