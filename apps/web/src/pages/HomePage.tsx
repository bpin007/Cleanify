import { useEffect, useState } from 'react';
import { fetchHealth } from '../api/health';
import { ThemeToggle } from '../components/ThemeToggle';
import { APP_NAME } from '../config';

type ApiState = { kind: 'checking' } | { kind: 'ok'; version: string } | { kind: 'down' };

const SWATCHES = [
  { token: 'fix-encoding', label: 'Encoding repair', className: 'bg-fix-encoding' },
  { token: 'fix-accent', label: 'Accent / ASCII', className: 'bg-fix-accent' },
  { token: 'fix-invisible', label: 'Invisible chars', className: 'bg-fix-invisible' },
  { token: 'fix-translate', label: 'Translation', className: 'bg-fix-translate' },
];

/**
 * Phase 0 placeholder. The real tool (paste box, drop zone, toggles) arrives in Phase 2.
 * This page only proves the theme tokens, Tailwind and the /api proxy are wired up.
 */
export function HomePage() {
  const [api, setApi] = useState<ApiState>({ kind: 'checking' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetchHealth(ctrl.signal)
      .then((h) => setApi({ kind: 'ok', version: h.version }))
      .catch(() => {
        if (!ctrl.signal.aborted) setApi({ kind: 'down' });
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16">
        <section className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Turn broken, messy or foreign text into clean English.
          </h1>
          <p className="mt-3 text-muted">
            Setup skeleton (Phase 0). The cleaning tool arrives in Phase 2.
          </p>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-muted">API</dt>
              <dd className="mt-1 font-mono" aria-live="polite">
                {api.kind === 'checking' && 'checking…'}
                {api.kind === 'ok' && `ok · v${api.version}`}
                {api.kind === 'down' && 'not reachable (is apps/api running?)'}
              </dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-muted">Engine</dt>
              <dd className="mt-1 font-mono">not built yet (Phase 1)</dd>
            </div>
          </dl>

          <ul className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="Highlight colours">
            {SWATCHES.map((s) => (
              <li
                key={s.token}
                className="flex items-center gap-2 rounded-full border border-border px-3 py-1"
              >
                <span aria-hidden="true" className={`size-3 rounded-full ${s.className}`} />
                {s.label}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
