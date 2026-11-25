/** Small form pieces shared by the account pages and the dashboard. */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export function Field({
  label,
  error,
  hint,
  ...input
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const described = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ');
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm aria-[invalid=true]:border-fix-invisible"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm text-fix-invisible-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'ok';
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        'rounded-lg border px-4 py-3 text-sm ' +
        (tone === 'error'
          ? 'border-fix-invisible bg-fix-invisible-bg'
          : 'border-border bg-surface-2')
      }
    >
      {children}
    </p>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="rounded-lg bg-accent px-4 py-2 font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}

export const secondaryButton =
  'inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
