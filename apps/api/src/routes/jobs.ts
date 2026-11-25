/**
 * Cloud jobs (PROJECT.md sections 6, 14 and 18). Anonymous jobs belong to the signed
 * anonymous session cookie and expire after ANON_RETENTION_MINUTES; signed-in users'
 * jobs stay in their history until deleted.
 *
 * Flow: POST /uploads (signed upload URL) → browser PUTs the file → POST /jobs starts
 * analysis → GET /jobs/:id until done → GET /jobs/:id/result → POST /decide (any number)
 * → POST /apply → GET /jobs/:id until the output is done → GET /download.
 */
import {
  applySchema,
  createJobSchema,
  createUploadSchema,
  decideSchema,
  formatOfFileName,
  toRuleSet,
  type CreateJobBody,
  type JobInfo,
  type RuleKind,
  type Quotas,
  type UploadTicket,
} from '@cleanify/shared';
import type { Decision } from '@cleanify/session';
import express, { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import { HttpError, notFound, parseBody } from '../middleware/errors.js';
import { ensureAnon } from '../middleware/session.js';
import { Job, Rule, SavedFile, Usage, newId, type JobDoc } from '../models.js';
import type { JobQueue } from '../jobs/queue.js';
import {
  JOBS,
  deleteJobFiles,
  keys,
  readAnalysis,
  type SessionCache,
  type WorkDeps,
} from '../jobs/work.js';

const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function quotasFor(config: Config, req: Request, jobsToday: number): Quotas {
  const user = Boolean(req.user);
  return {
    cloudFileBytes: user ? config.limits.userFileBytes : config.limits.anonFileBytes,
    cloudJobsPerDay: user ? config.limits.userJobsPerDay : config.limits.anonJobsPerDay,
    cloudJobsToday: jobsToday,
    storageBytes: user ? config.limits.userStorageBytes : null,
    retentionMinutes: user ? null : config.retention.anonMinutes,
  };
}

export async function jobsToday(subject: string | null): Promise<number> {
  if (!subject) return 0;
  const u = await Usage.findOne({ subject, day: today() }).lean();
  return u?.jobs ?? 0;
}

/** Counts a new job against today's quota, or refuses it. */
async function takeJobQuota(config: Config, req: Request, subject: string) {
  const max = req.user ? config.limits.userJobsPerDay : config.limits.anonJobsPerDay;
  const u = await Usage.findOneAndUpdate(
    { subject, day: today() },
    { $inc: { jobs: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  if (u!.jobs > max) {
    await Usage.updateOne({ subject, day: today() }, { $inc: { jobs: -1 } });
    throw new HttpError(
      429,
      'quota_exceeded',
      req.user
        ? `You've used today's ${max} cloud jobs. Browser mode has no limit.`
        : `You've used today's ${max} cloud jobs. Log in for more, or use browser mode, which has no limit.`,
    );
  }
}

/** Who owns new jobs: the user, or the anonymous session (created now if needed). */
function owner(config: Config, req: Request, res: Response) {
  if (req.user)
    return { ownerId: req.user._id, subject: req.user._id, root: `users/${req.user._id}` };
  const sid = ensureAnon(config, req, res);
  return { ownerId: null, anonSessionId: sid, subject: `anon:${sid}`, root: `anon/${sid}` };
}

/**
 * The settings a job runs with. Signed-in users get their saved, enabled rules (in
 * order), loaded here so the job keeps the rules it started with; anonymous users'
 * session-only rules come with the request (section 6).
 */
async function jobSettings(req: Request, settings: CreateJobBody['settings']) {
  if (!req.user) return settings;
  const saved = await Rule.find({ ownerId: req.user._id }).sort({ order: 1, createdAt: 1 }).lean();
  const rules = toRuleSet(
    saved.map((r) => ({
      kind: (r.kind ?? 'replace') as RuleKind,
      name: r.name,
      from: r.from,
      to: r.to ?? '',
      enabled: r.enabled ?? true,
    })),
  );
  return { ...settings, rules };
}

/** The job, if the caller owns it; otherwise 404 (never reveal that it exists). */
export async function ownJob(req: Request, id: string): Promise<JobDoc> {
  const job = await Job.findById(id).lean<JobDoc>();
  const mine =
    job &&
    ((req.user && job.ownerId === req.user._id) ||
      (!job.ownerId && req.anonId && job.anonSessionId === req.anonId));
  if (!mine || (job.expiresAt && job.expiresAt.getTime() <= Date.now()))
    throw notFound('Job not found');
  return job;
}

export function jobInfo(job: JobDoc, saved = false): JobInfo {
  const info: JobInfo = {
    id: job._id,
    status: job.status,
    progress: { phase: job.progress?.phase ?? '', fraction: job.progress?.fraction ?? 0 },
    input: {
      kind: job.input.kind,
      fileName: job.input.fileName ?? null,
      size: job.input.size ?? 0,
      format: job.input.format ?? 'text',
    },
    summary: (job.summary as Record<string, number> | null) ?? null,
    error: job.error ?? null,
    output: {
      status: job.output?.status ?? 'none',
      encoding: job.output?.encoding ?? null,
      fileName: job.output?.fileName ?? null,
    },
    saved,
    expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
    createdAt: (job as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
  if (job.output?.blockedChars)
    info.output.blockedChars = job.output.blockedChars as NonNullable<
      JobInfo['output']['blockedChars']
    >;
  return info;
}

const SIGNATURES: [string, number[]][] = [
  ['zip', [0x50, 0x4b, 0x03, 0x04]],
  ['ole', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ['pdf', [0x25, 0x50, 0x44, 0x46]],
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['exe', [0x4d, 0x5a]],
  ['elf', [0x7f, 0x45, 0x4c, 0x46]],
];
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const signatureOf = (b: Uint8Array) => SIGNATURES.find(([, s]) => startsWith(b, s))?.[0] ?? null;

/** File type by content, not just extension (section 17). */
export function contentMatches(fileName: string, head: Uint8Array): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const sig = signatureOf(head);
  switch (ext) {
    case 'xlsx':
    case 'ods':
      return sig === 'zip';
    case 'xls':
      return sig === 'ole';
    case 'accdb':
    case 'mdb': {
      const text = new TextDecoder('latin1').decode(head.subarray(4, 20));
      return text.startsWith('Standard Jet DB') || text.startsWith('Standard ACE DB');
    }
    default:
      // Text and CSV: anything except a known binary format (UTF-16 text has zero bytes).
      return sig === null;
  }
}

export interface JobRouteDeps {
  config: Config;
  work: WorkDeps;
  queue: JobQueue;
  cache: SessionCache;
}

export function jobRoutes({ config, work, queue, cache }: JobRouteDeps): Router {
  const router = Router();
  const { storage } = work;

  router.post('/uploads', async (req, res) => {
    const body = parseBody(createUploadSchema, req.body);
    const format = formatOfFileName(body.fileName);
    if (!format) throw new HttpError(400, 'unsupported_file', 'This kind of file is not supported');
    const maxBytes = req.user ? config.limits.userFileBytes : config.limits.anonFileBytes;
    if (body.size > maxBytes)
      throw new HttpError(
        413,
        'too_large',
        `Cloud mode takes files up to ${Math.round(maxBytes / 1024 / 1024)} MB${req.user ? '' : ' (more when logged in)'}. Browser mode has no fixed limit.`,
      );
    const who = owner(config, req, res);
    await takeJobQuota(config, req, who.subject);
    const jobId = newId();
    const prefix = `${who.root}/${jobId}`;
    await Job.create({
      _id: jobId,
      ownerId: who.ownerId,
      anonSessionId: who.anonSessionId ?? null,
      prefix,
      status: 'uploading',
      input: { kind: 'file', fileName: body.fileName, size: body.size, format },
      expiresAt: req.user ? null : new Date(Date.now() + config.retention.anonMinutes * 60_000),
    });
    const upload = await storage.signUpload('uploads', keys.input(prefix), {
      contentType: 'application/octet-stream',
      maxBytes,
    });
    const ticket: UploadTicket = { jobId, upload };
    res.status(201).json(ticket);
  });

  // Text jobs carry the text in the body: allow up to the largest cloud file size.
  const bigJson = express.json({ limit: config.limits.userFileBytes + 1024 * 1024 });

  router.post('/jobs', bigJson, async (req, res) => {
    const body = parseBody(createJobSchema, req.body);
    let job: JobDoc;
    if ('text' in body) {
      const bytes = new TextEncoder().encode(body.text);
      const maxBytes = req.user ? config.limits.userFileBytes : config.limits.anonFileBytes;
      if (bytes.length > maxBytes)
        throw new HttpError(413, 'too_large', 'That text is larger than cloud mode allows');
      const who = owner(config, req, res);
      await takeJobQuota(config, req, who.subject);
      const jobId = newId();
      const prefix = `${who.root}/${jobId}`;
      await storage.put('uploads', keys.input(prefix), bytes, 'text/plain; charset=utf-8');
      const created = await Job.create({
        _id: jobId,
        ownerId: who.ownerId,
        anonSessionId: who.anonSessionId ?? null,
        prefix,
        status: 'queued',
        input: { kind: 'text', fileName: null, size: bytes.length, format: 'text' },
        settings: await jobSettings(req, body.settings),
        expiresAt: req.user ? null : new Date(Date.now() + config.retention.anonMinutes * 60_000),
      });
      job = created.toObject() as JobDoc;
    } else {
      const existing = await ownJob(req, body.jobId);
      if (existing.status !== 'uploading')
        throw new HttpError(409, 'already_started', 'This job has already started');
      const head = await storage.head('uploads', keys.input(existing.prefix));
      if (!head) throw new HttpError(400, 'not_uploaded', 'The file has not been uploaded yet');
      const maxBytes = existing.ownerId ? config.limits.userFileBytes : config.limits.anonFileBytes;
      if (head.size > maxBytes) {
        await deleteJobFiles(storage, existing.prefix);
        throw new HttpError(413, 'too_large', 'The uploaded file is larger than allowed');
      }
      const bytes = await storage.get('uploads', keys.input(existing.prefix));
      if (!contentMatches(existing.input.fileName ?? '', bytes.subarray(0, 64))) {
        await deleteJobFiles(storage, existing.prefix);
        await Job.updateOne(
          { _id: existing._id },
          { status: 'failed', error: 'File content does not match its type' },
        );
        throw new HttpError(
          400,
          'content_mismatch',
          "The file's content doesn't match its extension. Check that it's the right file.",
        );
      }
      job = (await Job.findOneAndUpdate(
        { _id: existing._id, status: 'uploading' },
        {
          status: 'queued',
          settings: await jobSettings(req, body.settings),
          'input.size': head.size,
        },
        { returnDocument: 'after' },
      ).lean<JobDoc>())!;
    }
    await queue.enqueue(JOBS.process, { jobId: job._id });
    res.status(202).json(jobInfo(job));
  });

  router.get('/jobs/:id', async (req: Request<{ id: string }>, res) => {
    const job = await ownJob(req, req.params.id);
    const saved = job.ownerId ? Boolean(await SavedFile.exists({ jobId: job._id })) : false;
    res.set('Cache-Control', 'no-store').json(jobInfo(job, saved));
  });

  router.get('/jobs/:id/result', async (req: Request<{ id: string }>, res) => {
    const job = await ownJob(req, req.params.id);
    if (job.status !== 'done') throw new HttpError(409, 'not_ready', 'The job is not finished yet');
    res.set('Cache-Control', 'no-store');
    if ((job.decisions ?? []).length === 0) {
      // Untouched result: send the stored, already-compressed analysis as it is.
      const gz = await readAnalysis(work, job);
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.set('Content-Encoding', 'gzip');
      res.end(Buffer.from(gz));
      return;
    }
    const session = await cache.get(work, job);
    res.json(session.current());
  });

  router.post('/jobs/:id/decide', async (req: Request<{ id: string }>, res) => {
    const body = parseBody(decideSchema, req.body);
    const job = await ownJob(req, req.params.id);
    if (job.status !== 'done') throw new HttpError(409, 'not_ready', 'The job is not finished yet');
    const session = await cache.get(work, job);
    const view = session.decide(body.decisions as Decision[]);
    const updated = await Job.findOneAndUpdate(
      { _id: job._id },
      { $push: { decisions: { $each: body.decisions } }, 'output.status': 'none' },
      { returnDocument: 'after' },
    ).lean<JobDoc>();
    cache.note(job._id, updated!.decisions.length);
    res.json(view);
  });

  router.post('/jobs/:id/apply', async (req: Request<{ id: string }>, res) => {
    const body = parseBody(applySchema, req.body);
    const job = await ownJob(req, req.params.id);
    if (job.status !== 'done') throw new HttpError(409, 'not_ready', 'The job is not finished yet');
    const updated = await Job.findOneAndUpdate(
      { _id: job._id },
      {
        'output.status': 'queued',
        'output.encoding': body.encoding,
        'output.bomCount': body.bomCount,
        $inc: { 'output.version': 1 },
        $unset: { 'output.blockedChars': 1 },
      },
      { returnDocument: 'after' },
    ).lean<JobDoc>();
    await queue.enqueue(JOBS.output, { jobId: job._id, version: updated!.output.version });
    res.status(202).json(jobInfo(updated!));
  });

  router.get('/jobs/:id/download', async (req: Request<{ id: string }>, res) => {
    const job = await ownJob(req, req.params.id);
    if (job.output.status !== 'done' || !job.output.fileName)
      throw new HttpError(409, 'not_ready', 'The file is not ready yet');
    const url = await storage.signDownload('outputs', keys.output(job.prefix), {
      fileName: job.output.fileName,
    });
    res.set('Cache-Control', 'no-store').json({ url });
  });

  router.delete('/jobs/:id', async (req: Request<{ id: string }>, res) => {
    const job = await ownJob(req, req.params.id);
    await deleteJobFiles(storage, job.prefix);
    await Job.deleteOne({ _id: job._id });
    cache.drop(job._id);
    res.json({ ok: true });
  });

  return router;
}
