/** A single-purpose tool page: the tool with preset switches, then a short explanation. */
import { Clock } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { CleanTool } from '../components/CleanTool';
import { APP_NAME } from '../config';
import { DEFAULT_SETTINGS } from '../session/defaults';
import { useSession } from '../session/SessionContext';
import { NotFoundPage } from './NotFoundPage';
import { toolBySlug } from './tools';

export function ToolPage() {
  const { slug } = useParams();
  const tool = toolBySlug(slug);
  const { setSettings } = useSession();

  useEffect(() => {
    if (!tool) return;
    document.title = `${tool.title} · ${APP_NAME}`;
    setSettings({ ...DEFAULT_SETTINGS, ...tool.preset });
  }, [tool, setSettings]);

  if (!tool) return <NotFoundPage />;

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{tool.title}</h1>
        <p className="mt-2 max-w-3xl text-muted">{tool.intro}</p>
      </div>

      {tool.comingSoon && (
        <p className="flex gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
          <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">Coming soon. </span>
            {tool.comingSoon}
          </span>
        </p>
      )}

      {tool.example && (
        <figure className="grid gap-2 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-2">
          <figcaption className="sr-only">Example</figcaption>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Before</div>
            <p className="mt-1 font-mono break-words">{tool.example.before}</p>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">After</div>
            <p className="mt-1 font-mono break-words">{tool.example.after}</p>
          </div>
        </figure>
      )}

      <CleanTool placeholder={tool.placeholder} />

      <article className="grid max-w-3xl gap-5 border-t border-border pt-6">
        {tool.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-2 text-muted">
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
