/**
 * Cloud jobs (PROJECT.md section 14): `process-job` analyses the uploaded input,
 * `build-output` applies the user's decisions and writes the file to download,
 * `cleanup-expired` removes expired jobs and their files. Every one is idempotent: it
 * checks what is already done first, and writes to fixed keys, so running it again
 * after a restart changes nothing.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  EngineSession,
  type AnalyzedData,
  type CleanSettings,
  type Decision,
} from '@cleanify/session';
import type { Config } from '../config.js';
import { Job, type JobDoc } from '../models.js';
import type { StorageService } from '../services/storage/index.js';

export const JOBS = {
  process: 'process-job',
  output: 'build-output',
  cleanup: 'cleanup-expired',
} as const;

export const keys = {
  input: (prefix: string) => `${prefix}/input`,
  analysis: (prefix: string) => `${prefix}/analysis.json.gz`,
  output: (prefix: string) => `${prefix}/output`,
};

export interface WorkDeps {
  config: Config;
  storage: StorageService;
  log: (msg: string, e?: unknown) => void;
  now?: () => Date;
}

/** Kept-open sessions, so decisions on a big file don't re-read it every time. */
export class SessionCache {
  private readonly items = new Map<string, { session: EngineSession; decisions: number }>();
  constructor(private readonly max = 4) {}

  async get(deps: WorkDeps, job: JobDoc): Promise<EngineSession> {
    const hit = this.items.get(job._id);
    const decisions = (job.decisions ?? []) as Decision[];
    if (hit && hit.decisions <= decisions.length) {
      if (hit.decisions < decisions.length) hit.session.decide(decisions.slice(hit.decisions));
      hit.decisions = decisions.length;
      this.items.delete(job._id);
      this.items.set(job._id, hit);
      return hit.session;
    }
    const { session } = await openSession(deps, job);
    if (decisions.length > 0) session.decide(decisions);
    this.items.set(job._id, { session, decisions: decisions.length });
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value!);
    return session;
  }

  /** Records decisions already applied to a cached session. */
  note(jobId: string, count: number) {
    const hit = this.items.get(jobId);
    if (hit) hit.decisions = count;
  }

  drop(jobId: string) {
    this.items.delete(jobId);
  }
}

/** Analyses the job's input from storage with its settings (no decisions yet). */
export async function openSession(
  deps: WorkDeps,
  job: JobDoc,
  progress: (phase: string, fraction: number) => void = () => {},
): Promise<{ session: EngineSession; data: AnalyzedData }> {
  const bytes = await deps.storage.get('uploads', keys.input(job.prefix));
  const session = new EngineSession();
  const settings = job.settings as CleanSettings;
  const data =
    job.input.kind === 'text'
      ? await session.analyze(
          { kind: 'paste', text: new TextDecoder().decode(bytes) },
          settings,
          progress,
        )
      : await session.analyze(
          {
            kind: 'file',
            name: job.input.fileName ?? 'file',
            format: job.input.format,
            bytes: bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          },
          settings,
          progress,
        );
  return { session, data };
}

export function summaryOf(data: AnalyzedData): Record<string, number> {
  const counts: Record<string, number> = {};
  data.changes.forEach((c, i) => {
    if (data.applied[i]) counts[c.stage] = (counts[c.stage] ?? 0) + 1;
  });
  counts['total'] = data.changes.length;
  return counts;
}

export async function processJob(deps: WorkDeps, cache: SessionCache, jobId: string) {
  const job = await Job.findById(jobId).lean<JobDoc>();
  if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'expired') return;
  await Job.updateOne({ _id: jobId }, { status: 'running', 'progress.phase': 'Starting' });

  let last = 0;
  const progress = (phase: string, fraction: number) => {
    const now = Date.now();
    if (now - last < 1000 && fraction < 1) return;
    last = now;
    void Job.updateOne({ _id: jobId }, { progress: { phase, fraction } }).exec();
  };
  try {
    const { data } = await openSession(deps, job, progress);
    // Fixed key: running this again overwrites the same object.
    await deps.storage.put(
      'outputs',
      keys.analysis(job.prefix),
      gzipSync(JSON.stringify(data)),
      'application/gzip',
    );
    cache.drop(jobId);
    await Job.updateOne(
      { _id: jobId },
      { status: 'done', summary: summaryOf(data), progress: { phase: 'Done', fraction: 1 } },
    );
  } catch (e) {
    // The message goes to the user; file contents are never logged (section 17).
    const message = e instanceof Error ? e.message : String(e);
    deps.log(`[jobs] process ${jobId} failed`, message);
    await Job.updateOne({ _id: jobId }, { status: 'failed', error: message });
  }
}

export async function readAnalysis(deps: WorkDeps, job: JobDoc): Promise<Uint8Array> {
  return deps.storage.get('outputs', keys.analysis(job.prefix));
}

export const parseAnalysis = (gz: Uint8Array) =>
  JSON.parse(gunzipSync(gz).toString('utf8')) as AnalyzedData;

export function outputName(job: JobDoc): string {
  const name = job.input.fileName;
  if (job.input.kind === 'text' || !name) return 'cleaned.txt';
  const dot = name.lastIndexOf('.');
  const base = dot <= 0 ? name : name.slice(0, dot);
  if (job.input.format === 'sheet') return `${base}-clean.xlsx`;
  return dot <= 0 ? `${name}-clean` : `${base}-clean${name.slice(dot)}`;
}

export async function buildOutput(
  deps: WorkDeps,
  cache: SessionCache,
  jobId: string,
  version: number,
) {
  const job = await Job.findById(jobId).lean<JobDoc>();
  // A newer apply supersedes this one; a finished build needs nothing more.
  if (!job || job.status !== 'done' || job.output.version !== version) return;
  if (job.output.status === 'done' || job.output.status === 'blocked') return;
  await Job.updateOne({ _id: jobId, 'output.version': version }, { 'output.status': 'running' });
  try {
    const session = await cache.get(deps, job);
    const r = await session.serialize(
      (job.output.encoding ?? 'utf-8') as Parameters<EngineSession['serialize']>[0],
      job.output.bomCount ?? 0,
    );
    if (!r.ok) {
      await Job.updateOne(
        { _id: jobId, 'output.version': version },
        { 'output.status': 'blocked', 'output.blockedChars': r.chars },
      );
      return;
    }
    await deps.storage.put('outputs', keys.output(job.prefix), r.bytes, 'application/octet-stream');
    await Job.updateOne(
      { _id: jobId, 'output.version': version },
      {
        'output.status': 'done',
        'output.size': r.bytes.length,
        'output.fileName': outputName(job),
        $unset: { 'output.blockedChars': 1 },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.log(`[jobs] output ${jobId} failed`, message);
    await Job.updateOne({ _id: jobId, 'output.version': version }, { 'output.status': 'failed' });
  }
}

/** Deletes everything stored for a job, in both buckets. */
export async function deleteJobFiles(storage: StorageService, prefix: string) {
  await storage.deletePrefix('uploads', `${prefix}/`);
  await storage.deletePrefix('outputs', `${prefix}/`);
}

/**
 * Secondary cleanup (correction 5): the Cloudflare Cron Worker is the primary one and
 * works while this server sleeps. This removes expired job records with their files, and
 * any anon/ or api/ object older than the retention, exactly like the Worker does.
 */
export async function cleanupExpired(deps: WorkDeps) {
  const now = deps.now?.() ?? new Date();
  const expired = await Job.find({ expiresAt: { $lte: now } }).lean<JobDoc[]>();
  for (const job of expired) {
    await deleteJobFiles(deps.storage, job.prefix);
    await Job.deleteOne({ _id: job._id });
  }
  const limits: [string, number][] = [
    ['anon/', deps.config.retention.anonMinutes * 60_000],
    ['api/', deps.config.retention.apiHours * 3_600_000],
  ];
  let objects = 0;
  for (const bucket of ['uploads', 'outputs'] as const) {
    for (const [prefix, maxAge] of limits) {
      for (const o of await deps.storage.list(bucket, prefix)) {
        if (now.getTime() - o.uploadedAt.getTime() > maxAge) {
          await deps.storage.delete(bucket, o.key);
          objects++;
        }
      }
    }
  }
  return { jobs: expired.length, objects };
}
