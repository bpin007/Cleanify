/** Home = the tool (PROJECT.md section 8): paste or drop, toggles, Clean. */
import { useEffect } from 'react';
import { Link } from 'react-router';
import { CleanTool } from '../components/CleanTool';
import { APP_NAME } from '../config';
import { TOOLS } from './tools';

export function HomePage() {
  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Fix garbled, messy text in your browser
        </h1>
        <p className="mt-2 text-muted">
          Repairs text like <span className="font-mono">CafÃ©</span>, removes invisible characters
          and converts to plain ASCII. You review every change before you download.
        </p>
      </div>

      <CleanTool />

      <nav aria-label="Single-purpose tools" className="border-t border-border pt-5">
        <h2 className="text-sm font-medium text-muted">Or start from a single-purpose tool</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {TOOLS.map((t) => (
            <li key={t.slug}>
              <Link
                to={`/tools/${t.slug}`}
                className="inline-block rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
