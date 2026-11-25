import type { Progress } from '../session/SessionContext';

export function ProgressBar({
  progress,
  onCancel,
  label = 'Cleaning progress',
}: {
  progress: Progress;
  /** Without it there is no Cancel button (cloud jobs keep running on the server). */
  onCancel?: (() => void) | undefined;
  label?: string;
}) {
  const pct = Math.round(progress.fraction * 100);
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-surface p-4" aria-live="polite">
      <div className="flex items-center justify-between text-sm">
        <span>
          {progress.phase}… <span className="text-muted">{pct}%</span>
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-text"
          >
            Cancel
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
