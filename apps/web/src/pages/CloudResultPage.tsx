/**
 * Result view for a cloud job (/result/:jobId). The analysis and every decision live
 * on the server; Download asks it to build the file and then follows a signed link.
 */
import type { EncodingName } from '@cleanify/engine';
import type { JobInfo } from '@cleanify/shared';
import type { AnalyzedData, Decision, ViewData } from '@cleanify/session';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, account, jobs } from '../api/client';
import { analysisFinished, outputFinished, pollJob } from '../api/cloud';
import { errorMessage, useMe } from '../api/queries';
import { ProgressBar } from '../components/ProgressBar';
import type { SaveResult } from '../session/SessionContext';
import { ResultView } from './ResultPage';

export function CloudResultPage() {
  const { jobId = '' } = useParams();
  // A fresh component per job, so nothing from the previous job is shown.
  return <CloudResult key={jobId} jobId={jobId} />;
}

function CloudResult({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobInfo | null>(null);
  const [data, setData] = useState<AnalyzedData | null>(null);
  const [view, setView] = useState<ViewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const signedIn = Boolean(useMe().data?.user);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const j = await pollJob(jobId, analysisFinished, setJob, ctl.signal);
        if (j.status !== 'done') {
          if (j.status === 'expired') setMissing(true);
          else setError(j.error ?? 'The job failed');
          return;
        }
        const result = await jobs.result(jobId);
        if (ctl.signal.aborted) return;
        setData(result);
        setView(result);
      } catch (e) {
        if (ctl.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(errorMessage(e));
      }
    })();
    return () => ctl.abort();
  }, [jobId]);

  const decide = useCallback(
    async (d: Decision[]) => {
      setBusy(true);
      setError(null);
      try {
        setView(await jobs.decide(jobId, d));
        // Decisions make any built file stale.
        setJob((j) => (j ? { ...j, output: { ...j.output, status: 'none' } } : j));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [jobId],
  );

  const save = useCallback(
    async (encoding: EncodingName, bomCount: number): Promise<SaveResult> => {
      await jobs.apply(jobId, encoding, bomCount);
      const j = await pollJob(jobId, outputFinished, setJob);
      if (j.output.status === 'blocked')
        return { ok: false, encoding, chars: j.output.blockedChars ?? [] };
      if (j.output.status !== 'done') throw new Error(j.error ?? 'Could not build the file');
      return { ok: true, url: (await jobs.download(jobId)).url };
    },
    [jobId],
  );

  if (missing) {
    return (
      <div className="grid gap-3 py-16 text-center">
        <h1 className="text-2xl font-semibold">This job is gone</h1>
        <p className="text-muted">
          It was deleted, it expired, or it belongs to someone else. Anonymous cloud jobs are
          deleted an hour after processing.
        </p>
        <p>
          <Link to="/" className="text-accent-text underline">
            Clean some text
          </Link>
        </p>
      </div>
    );
  }

  if (!data || !view || !job) {
    return (
      <div className="mx-auto grid max-w-xl gap-4 py-16">
        <h1 className="text-xl font-semibold">{job?.input.fileName ?? 'Cloud job'}</h1>
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-fix-invisible bg-fix-invisible-bg px-4 py-3 text-sm"
          >
            Something went wrong: {error}
          </p>
        ) : (
          <ProgressBar
            label="Cloud job progress"
            progress={{
              phase: !job
                ? 'Connecting'
                : job.status === 'queued'
                  ? 'Waiting'
                  : job.progress.phase || 'Working',
              fraction: job?.progress.fraction ?? 0,
            }}
          />
        )}
        <p className="text-sm text-muted">
          {error ? (
            <Link to="/" className="text-accent-text underline">
              Start again
            </Link>
          ) : (
            'This page updates by itself. The first job after a quiet spell can take up to a minute while the server wakes up.'
          )}
        </p>
      </div>
    );
  }

  return (
    <ResultView
      backend={{
        data,
        view,
        busy,
        error,
        // While the file builds, the Download button itself says "Preparing…".
        progress: null,
        decide,
        save,
        note: <JobNote job={job} />,
        actions: signedIn ? <SaveToFiles job={job} onSaved={setJob} /> : undefined,
      }}
    />
  );
}

function JobNote({ job }: { job: JobInfo }) {
  const until = job.expiresAt
    ? new Date(job.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <p className="mt-1 text-sm text-muted" data-testid="job-note">
      Cloud job · {until ? `deleted from our server at ${until}` : 'kept in your history'}
    </p>
  );
}

function SaveToFiles({ job, onSaved }: { job: JobInfo; onSaved: (j: JobInfo) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (job.saved)
    return (
      <Link
        to="/app/files"
        className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2"
      >
        <BookmarkCheck aria-hidden="true" className="size-4" /> In my files
      </Link>
    );
  const ready = job.output.status === 'done';
  return (
    <>
      <button
        type="button"
        disabled={!ready || saving}
        title={ready ? undefined : 'Download first, so the cleaned file exists'}
        onClick={async () => {
          setProblem(null);
          setSaving(true);
          try {
            await account.saveFile(job.id);
            onSaved({ ...job, saved: true });
          } catch (e) {
            setProblem(errorMessage(e));
          } finally {
            setSaving(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <BookmarkPlus aria-hidden="true" className="size-4" /> Save to my files
      </button>
      {problem && (
        <p role="alert" className="w-full text-sm text-fix-invisible-text">
          {problem}
        </p>
      )}
    </>
  );
}
