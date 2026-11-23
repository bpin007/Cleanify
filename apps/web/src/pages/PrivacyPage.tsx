/**
 * /privacy (PROJECT.md sections 8 and 17): what stays local, what is uploaded, retention.
 *
 * Today only browser mode exists, so the page says exactly what happens now and marks
 * the cloud, translation and account rules (wording from section 17, decision D4) as
 * applying when those features launch.
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
          What stays on your device, what would ever be uploaded, and for how long.
        </p>
      </div>

      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Browser mode (what {APP_NAME} does today)</h2>
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

      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Translation (coming later)</h2>
        <p className="text-muted">These rules will apply when translation launches:</p>
        <ul className="grid list-disc gap-2 pl-5">
          <li>
            Translation sends <strong>only the text pieces that need translating</strong>, after
            masking numbers, emails, URLs and IDs, <strong>never the whole file</strong>. In browser
            mode, everything else stays on the device.
          </li>
          <li>
            Those pieces go to our server and then to a translation provider: Cloudflare (Workers
            AI), MyMemory, or our own LibreTranslate server hosted on Hugging Face.
          </li>
          <li>You’ll be asked before anything is sent.</li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Cloud mode and accounts (coming later)</h2>
        <p className="text-muted">These rules will apply when cloud mode and accounts launch:</p>
        <ul className="grid list-disc gap-2 pl-5">
          <li>Anonymous cloud files are deleted after 1 hour.</li>
          <li>
            File contents are never used for anything except processing your own job. They are never
            logged and never used for training.
          </li>
          <li>You can delete your account and all your files at any time.</li>
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
