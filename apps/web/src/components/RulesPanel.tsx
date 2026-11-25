/**
 * The user's own rules, under the toggles (PROJECT.md sections 5 and 6). Signed-in users
 * see their saved rules and manage them in the dashboard; anonymous users can add
 * rules that last for this tab only.
 */
import type { RuleKind } from '@cleanify/shared';
import { ListChecks, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { SessionRule, useRules } from '../api/rules';
import { errorMessage } from '../api/queries';
import { Field, secondaryButton } from './Form';

/** “™” → “TM”, or keep “é”. */
export function RuleText({ rule }: { rule: Pick<SessionRule, 'kind' | 'from' | 'to'> }) {
  return rule.kind === 'keep' ? (
    <span className="font-mono">keep “{rule.from}”</span>
  ) : (
    <span className="font-mono">
      “{rule.from}” → “{rule.to}”
    </span>
  );
}

export function RulesPanel({ rules }: { rules: ReturnType<typeof useRules> }) {
  const on = rules.list.filter((r) => r.enabled);
  return (
    <details className="group rounded-xl border border-border bg-surface px-4 py-3 sm:px-5">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <ListChecks aria-hidden="true" className="size-4 text-fix-rule-text" />
        Your rules
        <span className="font-normal text-muted">
          {on.length === 0 ? 'none' : `${on.length} on`}
        </span>
      </summary>
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted">
          Replace rules run after the encoding repair and before the ASCII step, so “™ → TM” wins
          over the ASCII step’s “(TM)”. Keep rules stop the ASCII step from changing some text.
          Every rule change shows up for review.
        </p>
        {rules.error && <p role="alert">Couldn’t load your rules: {errorMessage(rules.error)}</p>}
        {rules.list.length > 0 && (
          <ul className="grid gap-1">
            {rules.list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={r.enabled ? '' : 'text-muted line-through'}>
                  <RuleText rule={r} />
                </span>
                <span className="text-muted">{r.name}</span>
                {!rules.signedIn && (
                  <button
                    type="button"
                    className={secondaryButton + ' ml-auto'}
                    onClick={() => rules.removeSessionRule(r.id)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    <span className="sr-only">Remove rule {r.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {rules.signedIn ? (
          <p>
            <Link to="/app/rules" className="text-accent-text underline">
              Manage your rules
            </Link>
          </p>
        ) : (
          <>
            <AddRuleForm onAdd={(r) => rules.addSessionRule(r)} submitLabel="Add for this tab" />
            <p className="text-muted">
              These last until you close this tab.{' '}
              <Link to="/login" className="text-accent-text underline">
                Log in
              </Link>{' '}
              to save rules.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

/** The add-a-rule form, shared by this panel and the dashboard's Rules page. */
export function AddRuleForm({
  onAdd,
  submitLabel = 'Add',
  busy = false,
}: {
  onAdd: (r: { kind: RuleKind; name: string; from: string; to: string }) => unknown;
  submitLabel?: string;
  busy?: boolean;
}) {
  const [kind, setKind] = useState<RuleKind>('replace');
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const from = String(f.get('from') ?? '');
    const to = kind === 'keep' ? '' : String(f.get('to') ?? '');
    if (from === '') return;
    const name =
      String(f.get('name') ?? '').trim() || (kind === 'keep' ? `Keep ${from}` : `${from} → ${to}`);
    if ((await onAdd({ kind, name: name.slice(0, 100), from, to })) !== false) form.reset();
  };
  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-[auto_1fr_1fr_1fr_auto] sm:items-end"
    >
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Kind</legend>
        <div className="flex gap-3 text-sm">
          {(['replace', 'keep'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {k === 'replace' ? 'Replace' : 'Keep'}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label={kind === 'keep' ? 'Text to keep' : 'Find'}
        name="from"
        required
        maxLength={500}
      />
      {kind === 'replace' ? (
        <Field label="Replace with" name="to" maxLength={500} />
      ) : (
        <span aria-hidden="true" />
      )}
      <Field label="Name (optional)" name="name" maxLength={100} />
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'Adding…' : submitLabel}
      </button>
    </form>
  );
}
