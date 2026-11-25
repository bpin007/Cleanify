/**
 * The tool itself (PROJECT.md section 8): paste or drop, toggles, mode, Clean. Used by
 * the home page and every single-purpose tool page.
 */
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { startCloudJob } from '../api/cloud';
import { errorMessage, useMe } from '../api/queries';
import { formatBytes, plural } from '../lib/labels';
import { useSession, type Progress } from '../session/SessionContext';
import { PasteDrop, type DraftInput } from './PasteDrop';
import { PipelineToggles } from './PipelineToggles';
import { ProgressBar } from './ProgressBar';

export function CleanTool({ placeholder }: { placeholder?: string | undefined }) {
  const session = useSession();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftInput>({ kind: 'paste', text: '' });
  const [cloudProgress, setCloudProgress] = useState<Progress | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const meQuery = useMe();
  const quotas = meQuery.data?.quotas;

  const cloud = session.mode === 'cloud';
  const empty = draft.kind === 'paste' && draft.text.length === 0;
  const nothingOn = !session.settings.repair && !session.settings.ascii;
  const size = draft.kind === 'file' ? draft.file.size : new Blob([draft.text]).size;
  const tooBig = cloud && quotas !== undefined && size > quotas.cloudFileBytes;

  const onClean = async () => {
    if (cloud) {
      setCloudError(null);
      try {
        const id = await startCloudJob(draft, session.settings, setCloudProgress);
        navigate(`/result/${id}`);
      } catch (e) {
        setCloudError(errorMessage(e));
      } finally {
        setCloudProgress(null);
      }
      return;
    }
    const input =
      draft.kind === 'paste'
        ? ({ kind: 'paste', text: draft.text } as const)
        : ({
            kind: 'file',
            name: draft.file.name,
            format: draft.format,
            bytes: await draft.file.arrayBuffer(),
          } as const);
    if (await session.clean(input)) navigate('/result/local');
  };

  const error = cloud ? cloudError : session.error;
  const progress = cloud ? cloudProgress : session.progress;

  return (
    <div className="grid gap-5">
      <PasteDrop value={draft} onChange={setDraft} placeholder={placeholder} />
      <PipelineToggles
        settings={session.settings}
        onChange={session.setSettings}
        mode={session.mode}
        onModeChange={session.setMode}
      />

      {cloud && quotas && (
        <p className="-mt-2 text-sm text-muted" data-testid="cloud-note">
          Uploaded over HTTPS to our server, up to {formatBytes(quotas.cloudFileBytes)}.{' '}
          {quotas.retentionMinutes !== null
            ? `Deleted ${retention(quotas.retentionMinutes)} after processing.`
            : 'Kept in your history until you delete it.'}{' '}
          {quotas.cloudJobsPerDay - quotas.cloudJobsToday} of {quotas.cloudJobsPerDay} cloud jobs
          left today.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-fix-invisible bg-fix-invisible-bg px-4 py-3 text-sm"
        >
          Something went wrong: {error}
        </p>
      )}

      {progress ? (
        <ProgressBar
          progress={progress}
          onCancel={cloud ? undefined : session.cancel}
          label={cloud ? 'Upload progress' : 'Cleaning progress'}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onClean}
            disabled={empty || nothingOn || tooBig}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-medium text-on-accent shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles aria-hidden="true" className="size-4" /> Clean
          </button>
          {nothingOn && (
            <span className="text-sm text-muted">Turn on at least one step above.</span>
          )}
          {tooBig && quotas && (
            <span className="text-sm text-fix-invisible-text">
              Cloud mode takes up to {formatBytes(quotas.cloudFileBytes)}. Use browser mode for this
              file.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const retention = (minutes: number) =>
  minutes % 60 === 0
    ? plural(minutes / 60, ['hour', 'hours'])
    : plural(minutes, ['minute', 'minutes']);
