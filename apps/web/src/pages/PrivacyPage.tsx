/**
 * /privacy (PROJECT.md sections 8 and 17): what stays local, what is uploaded, retention.
 *
 * It describes ONLY what exists today (browser mode). The section 17 rules for
 * translation, cloud mode and accounts are added here when each of those launches.
 */
import { useEffect } from 'react';
import { Link } from 'react-router';
import { APP_NAME } from '../config';

export function PrivacyPage() {
  useEffect(() => {
    document.title = `Privacy · ${APP_NAME}`;
  }, []);

  return (
    <article className="grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Privacy</h1>
        <p className="mt-2 text-muted">
          What happens to your text and files when you use {APP_NAME}.
        </p>
      </div>

      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Everything runs in your browser</h2>
        <ul className="grid list-disc gap-2 pl-5">
          <li>
            In browser mode, <strong>files never leave the device</strong>. Your text and files are
            read and cleaned by code running in this browser tab, in a background worker. Nothing is
            uploaded.
          </li>
          <li>
            Results are kept only in this tab’s memory. Reloading or closing the tab removes them.
            Nothing is saved on your device or on our side.
          </li>
          <li>
            The site makes no requests to other companies: fonts are served with the site, and there
            are no analytics, ads or tracking cookies.
          </li>
          <li>
            The one thing this site stores is your theme choice (light, dark or system), in this
            browser’s local storage.
          </li>
        </ul>
      </section>

      <p className="text-sm text-muted">
        <Link to="/" className="text-accent-text underline">
          Back to the tool
        </Link>
      </p>
    </article>
  );
}
