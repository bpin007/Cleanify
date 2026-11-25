/** The signed-in dashboard (PROJECT.md section 8): /app, history, files, rules, settings. */
import type { Stage } from '@cleanify/engine';
import type { JobInfo, RuleInfo } from '@cleanify/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { account, auth, me as meApi } from '../api/client';
import { ME_KEY, errorMessage, useMe, useRefreshMe } from '../api/queries';
import { Alert, Field, SubmitButton, secondaryButton } from '../components/Form';
import { PipelineToggles } from '../components/PipelineToggles';
import { APP_NAME } from '../config';
import { formatBytes, summary } from '../lib/labels';
import type { CleanSettings } from '@cleanify/session';
import { DEFAULT_SETTINGS, withDefaults } from '../session/defaults';
import { useSession } from '../session/SessionContext';

function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);
}

function downloadUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.click();
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const TABS = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/history', label: 'History' },
  { to: '/app/files', label: 'Files' },
  { to: '/app/rules', label: 'Rules' },
  { to: '/app/settings', label: 'Settings' },
];

export function DashboardLayout() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <p className="py-16 text-center text-muted">Loading…</p>;
  if (me.isError) return <Alert>Couldn’t reach the server: {errorMessage(me.error)}</Alert>;
  if (!me.data.user)
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <div className="grid gap-6">
      <nav aria-label="Dashboard" className="-mx-4 overflow-x-auto border-b border-border px-4">
        <ul className="flex gap-1">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end ?? false}
                className={({ isActive }) =>
                  'inline-block border-b-2 px-3 py-2 text-sm ' +
                  (isActive
                    ? 'border-accent font-medium text-text'
                    : 'border-transparent text-muted hover:text-text')
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}

export function OverviewPage() {
  useTitle('Dashboard');
  const { user, quotas } = useMe().data!;
  const [resent, setResent] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hello{user!.name ? `, ${user!.name}` : ''}
      </h1>
      {!user!.emailVerified && (
        <Alert tone="ok">
          Confirm your email with the link we sent to {user!.email}.{' '}
          <button
            type="button"
            className="underline"
            onClick={() =>
              auth
                .resendVerification()
                .then(() => setResent('Sent again.'))
                .catch((e) => setResent(errorMessage(e)))
            }
          >
            Send it again
          </button>{' '}
          {resent}
        </Alert>
      )}
      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Cloud jobs today"
          value={`${quotas.cloudJobsToday} of ${quotas.cloudJobsPerDay}`}
        />
        <Stat
          label="Saved files"
          value={`${formatBytes(user!.storageUsedBytes)} of ${quotas.storageBytes ? formatBytes(quotas.storageBytes) : '—'}`}
        />
        <Stat label="Cloud file size limit" value={formatBytes(quotas.cloudFileBytes)} />
      </dl>
      <p>
        <Link
          to="/"
          className="inline-block rounded-lg bg-accent px-4 py-2 font-medium text-on-accent hover:opacity-90"
        >
          Clean something
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

const STATUS_LABELS: Record<JobInfo['status'], string> = {
  uploading: 'Uploading',
  queued: 'Waiting',
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  expired: 'Expired',
};

/** "3 encoding fixes · 1 accent", like the result page (the API also sends a total). */
function jobSummary(j: JobInfo): string {
  if (!j.summary) return '';
  const { total: _total, ...byStage } = j.summary;
  return summary(byStage as Partial<Record<Stage, number>>);
}

export function HistoryPage() {
  useTitle('History');
  const qc = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => account.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (id: string) => account.removeHistory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['history'] }),
  });
  const list = history.data?.pages.flatMap((p) => p.jobs) ?? [];

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="text-sm text-muted">
        Your cloud jobs. Browser-mode cleaning never reaches our server, so it isn’t listed.
      </p>
      {history.isError && <Alert>{errorMessage(history.error)}</Alert>}
      {remove.isError && <Alert>{errorMessage(remove.error)}</Alert>}
      {history.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted">No cloud jobs yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {list.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link to={`/result/${j.id}`} className="font-medium hover:underline">
                  {j.input.fileName ?? 'Pasted text'}
                </Link>
                <p className="text-sm text-muted">
                  {dateTime(j.createdAt)} · {STATUS_LABELS[j.status]}
                  {j.summary ? ` · ${jobSummary(j)}` : ''}
                  {j.saved ? ' · saved' : ''}
                </p>
              </div>
              <button
                type="button"
                className={secondaryButton}
                disabled={remove.isPending}
                onClick={() => remove.mutate(j.id)}
              >
                <Trash2 aria-hidden="true" className="size-4" /> Delete
                <span className="sr-only"> {j.input.fileName ?? 'pasted text'} job</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <button
          type="button"
          className={secondaryButton + ' justify-self-start'}
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </section>
  );
}

export function FilesPage() {
  useTitle('Files');
  const qc = useQueryClient();
  const { user, quotas } = useMe().data!;
  const files = useQuery({ queryKey: ['files'], queryFn: () => account.files() });
  const [problem, setProblem] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => account.removeFile(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
      <p className="text-sm text-muted">
        {formatBytes(user!.storageUsedBytes)} of{' '}
        {quotas.storageBytes ? formatBytes(quotas.storageBytes) : '—'} used. Saved files stay until
        you delete them. Save one with “Save to my files” on a cloud result.
      </p>
      {files.isError && <Alert>{errorMessage(files.error)}</Alert>}
      {(problem ?? remove.error) && <Alert>{problem ?? errorMessage(remove.error)}</Alert>}
      {files.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : files.data?.files.length === 0 ? (
        <p className="text-muted">No saved files yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {files.data?.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.name}</p>
                <p className="text-sm text-muted">
                  {formatBytes(f.size)} · {dateTime(f.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className={secondaryButton}
                onClick={async () => {
                  setProblem(null);
                  try {
                    downloadUrl((await account.fileDownload(f.id)).url);
                  } catch (e) {
                    setProblem(errorMessage(e));
                  }
                }}
              >
                <Download aria-hidden="true" className="size-4" /> Download
                <span className="sr-only"> {f.name}</span>
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={remove.isPending}
                onClick={() => remove.mutate(f.id)}
              >
                <Trash2 aria-hidden="true" className="size-4" /> Delete
                <span className="sr-only"> {f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RulesPage() {
  useTitle('Rules');
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => account.rules() });
  const refresh = () => qc.invalidateQueries({ queryKey: ['rules'] });
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setProblem(errorMessage(e));
      return false;
    }
  };

  const onAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setAdding(true);
    const ok = await run(() =>
      account.addRule({
        name: String(f.get('name') ?? '').trim(),
        from: String(f.get('from') ?? ''),
        to: String(f.get('to') ?? ''),
        enabled: true,
      }),
    );
    setAdding(false);
    if (ok) form.reset();
  };

  const list: RuleInfo[] = rules.data?.rules ?? [];
  const move = (i: number, by: -1 | 1) => {
    const other = list[i + by];
    const rule = list[i];
    if (!rule || !other) return;
    void run(async () => {
      await account.updateRule(rule.id, { order: other.order });
      await account.updateRule(other.id, { order: rule.order });
    });
  };

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Replacement rules</h1>
      <p className="text-sm text-muted">
        Your own find-and-replace rules, kept in your account in this order. Matching is exact text,
        not patterns.
      </p>
      {rules.isError && <Alert>{errorMessage(rules.error)}</Alert>}
      {problem && <Alert>{problem}</Alert>}
      {rules.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted">No rules yet.</p>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border bg-surface">
          {list.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="font-mono text-sm text-muted">
                  “{r.from}” → “{r.to}”
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) =>
                    void run(() => account.updateRule(r.id, { enabled: e.target.checked }))
                  }
                />
                On<span className="sr-only">: {r.name}</span>
              </label>
              <button
                type="button"
                className={secondaryButton}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
                <span className="sr-only">Move {r.name} up</span>
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden="true" className="size-4" />
                <span className="sr-only">Move {r.name} down</span>
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => void run(() => account.removeRule(r.id))}
              >
                <Trash2 aria-hidden="true" className="size-4" /> Delete
                <span className="sr-only"> {r.name}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={onAdd}
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      >
        <h2 className="text-sm font-medium sm:col-span-4">Add a rule</h2>
        <Field label="Name" name="name" required maxLength={100} />
        <Field label="Find" name="from" required maxLength={500} />
        <Field label="Replace with" name="to" maxLength={500} />
        <SubmitButton busy={adding}>Add</SubmitButton>
      </form>
    </section>
  );
}

export function SettingsPage() {
  useTitle('Settings');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refreshMe = useRefreshMe();
  const session = useSession();
  const { user } = useMe().data!;
  const [stages, setStages] = useState<CleanSettings>(() =>
    user!.settings.defaultStages ? withDefaults(user!.settings.defaultStages) : DEFAULT_SETTINGS,
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    setProblem(null);
    setSaved(null);
    setBusy(true);
    try {
      await meApi.update({ name, settings: { defaultStages: stages } });
      session.setSettings(stages);
      await refreshMe();
      setSaved('Saved.');
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const confirm = String(new FormData(e.currentTarget).get('confirm') ?? '');
    setProblem(null);
    try {
      await meApi.remove(confirm);
      qc.clear();
      navigate('/', { replace: true });
    } catch (err) {
      setProblem(errorMessage(err));
    }
  };

  return (
    <section className="grid max-w-2xl gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {problem && <Alert>{problem}</Alert>}

      <form onSubmit={onSave} className="grid gap-4">
        <Field label="Email" value={user!.email} readOnly disabled />
        <Field
          label="Name"
          name="name"
          defaultValue={user!.name}
          maxLength={100}
          autoComplete="name"
        />
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">Default cleaning steps</h2>
          <PipelineToggles settings={stages} onChange={setStages} />
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton busy={busy}>Save</SubmitButton>
          <span role="status" className="text-sm text-muted">
            {saved}
          </span>
        </div>
      </form>

      <form onSubmit={onDelete} className="grid gap-3 rounded-xl border border-fix-invisible p-4">
        <h2 className="font-semibold">Delete account</h2>
        <p className="text-sm text-muted">
          Deletes your account, history, saved files and rules right away. This can’t be undone.
        </p>
        <Field
          label={`Type ${user!.email} to confirm`}
          name="confirm"
          type="email"
          autoComplete="off"
          required
        />
        <button
          type="submit"
          className="justify-self-start rounded-lg border border-fix-invisible px-4 py-2 text-sm font-medium hover:bg-fix-invisible-bg"
        >
          Delete my account
        </button>
      </form>
    </section>
  );
}
