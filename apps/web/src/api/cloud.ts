/**
 * Cloud mode (PROJECT.md section 6): upload, start a job, and poll it. The API runs
 * jobs in the background, so the browser asks GET /jobs/:id until the step it waits
 * for is finished. Render may be waking up, so the first answer can take a while.
 */
import type { JobInfo } from '@cleanify/shared';
import type { CleanSettings } from '@cleanify/session';
import type { DraftInput } from '../components/PasteDrop';
import type { Progress } from '../session/SessionContext';
import { jobs, putFile } from './client';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Asks for the job until `until` holds, backing off from 0.5 s to 3 s between asks. */
export async function pollJob(
  id: string,
  until: (j: JobInfo) => boolean,
  onUpdate: (j: JobInfo) => void = () => {},
  signal?: AbortSignal,
): Promise<JobInfo> {
  let delay = 500;
  for (;;) {
    const j = await jobs.get(id);
    if (signal?.aborted) throw signal.reason;
    onUpdate(j);
    if (until(j)) return j;
    await sleep(delay, signal);
    delay = Math.min(delay * 1.5, 3000);
  }
}

export const analysisFinished = (j: JobInfo) =>
  j.status === 'done' || j.status === 'failed' || j.status === 'expired';

export const outputFinished = (j: JobInfo) =>
  j.output.status === 'done' || j.output.status === 'blocked' || j.output.status === 'failed';

/** Uploads the draft and starts the job. Returns the job id; the result page polls it. */
export async function startCloudJob(
  draft: DraftInput,
  settings: CleanSettings,
  onProgress: (p: Progress) => void,
): Promise<string> {
  if (draft.kind === 'paste') {
    onProgress({ phase: 'Sending', fraction: 0 });
    return (await jobs.startText(draft.text, settings)).id;
  }
  onProgress({ phase: 'Preparing upload', fraction: 0 });
  const ticket = await jobs.upload(draft.file.name, draft.file.size);
  await putFile(ticket, draft.file, (f) => onProgress({ phase: 'Uploading', fraction: f }));
  onProgress({ phase: 'Starting', fraction: 1 });
  return (await jobs.startFile(ticket.jobId, settings)).id;
}
