import { Lock } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { APP_NAME } from '../config';
import { ThemeToggle } from './ThemeToggle';

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-lg bg-accent font-mono text-sm text-on-accent"
            >
              C
            </span>
            {APP_NAME}
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-4 text-sm text-muted">
          <Lock aria-hidden="true" className="size-4" />
          Browser mode: your text is processed on this device and never uploaded.
        </p>
      </footer>
    </div>
  );
}
