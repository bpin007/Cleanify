/**
 * The signed-in user's things (PROJECT.md sections 8 and 14): profile and settings,
 * saved files (200 MB), replacement rules, job history, and deleting the account
 * with everything in it.
 */
import {
  deleteMeSchema,
  ruleSchema,
  saveFileSchema,
  updateMeSchema,
  updateRuleSchema,
  type MeResponse,
  type MeUser,
  type RuleInfo,
  type SavedFileInfo,
} from '@cleanify/shared';
import { Router, type Request } from 'express';
import type { Config } from '../config.js';
import { HttpError, notFound, parseBody } from '../middleware/errors.js';
import { requireUser } from '../middleware/session.js';
import {
  AuthToken,
  Job,
  Rule,
  SavedFile,
  Session,
  Usage,
  User,
  newId,
  type JobDoc,
  type UserDoc,
} from '../models.js';
import { deleteJobFiles, keys, type SessionCache, type WorkDeps } from '../jobs/work.js';
import { clearAuthCookies } from './auth.js';
import { jobInfo, jobsToday, ownJob, quotasFor } from './jobs.js';

const MAX_RULES = 200;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

export function meUser(u: UserDoc): MeUser {
  return {
    id: u._id,
    email: u.email,
    name: u.name ?? '',
    emailVerified: Boolean(u.emailVerified),
    hasPassword: Boolean(u.passwordHash),
    google: Boolean(u.googleId),
    settings: {
      theme: (u.settings?.theme ?? 'system') as MeUser['settings']['theme'],
      defaultStages: (u.settings?.defaultStages ?? null) as MeUser['settings']['defaultStages'],
    },
    storageUsedBytes: u.storageUsedBytes ?? 0,
    createdAt: iso((u as unknown as { createdAt: Date }).createdAt),
  };
}

function ruleInfo(r: Record<string, unknown>): RuleInfo {
  return {
    id: String(r['_id']),
    kind: r['kind'] === 'keep' ? 'keep' : 'replace',
    name: String(r['name']),
    from: String(r['from']),
    to: String(r['to'] ?? ''),
    enabled: Boolean(r['enabled']),
    order: Number(r['order'] ?? 0),
    createdAt: iso(r['createdAt']),
  };
}

function fileInfo(f: Record<string, unknown>): SavedFileInfo {
  return {
    id: String(f['_id']),
    jobId: String(f['jobId']),
    name: String(f['name']),
    size: Number(f['size']),
    format: String(f['format']),
    createdAt: iso(f['createdAt']),
  };
}

export interface AccountDeps {
  config: Config;
  work: WorkDeps;
  cache: SessionCache;
  googleEnabled: boolean;
}

export function accountRoutes({ config, work, cache, googleEnabled }: AccountDeps): Router {
  const router = Router();
  const { storage } = work;

  router.get('/me', async (req, res) => {
    const subject = req.user ? req.user._id : req.anonId ? `anon:${req.anonId}` : null;
    const body: MeResponse = {
      user: req.user ? meUser(req.user) : null,
      quotas: quotasFor(config, req, await jobsToday(subject)),
      google: { enabled: googleEnabled },
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.patch('/me', requireUser, async (req, res) => {
    const body = parseBody(updateMeSchema, req.body);
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set['name'] = body.name;
    if (body.settings?.theme) set['settings.theme'] = body.settings.theme;
    if (body.settings?.defaultStages) set['settings.defaultStages'] = body.settings.defaultStages;
    const user = await User.findByIdAndUpdate(
      req.user!._id,
      { $set: set },
      { returnDocument: 'after' },
    ).lean<UserDoc>();
    res.json({ user: meUser(user!) });
  });

  router.delete('/me', requireUser, async (req, res) => {
    const body = parseBody(deleteMeSchema, req.body);
    const user = req.user!;
    if (body.confirm !== user.email)
      throw new HttpError(400, 'confirm_mismatch', 'Type your account email to confirm');
    // Files first (everything under users/{id}/), then every record.
    await storage.deletePrefix('uploads', `users/${user._id}/`);
    await storage.deletePrefix('outputs', `users/${user._id}/`);
    await Promise.all([
      Job.deleteMany({ ownerId: user._id }),
      SavedFile.deleteMany({ ownerId: user._id }),
      Rule.deleteMany({ ownerId: user._id }),
      Session.deleteMany({ userId: user._id }),
      AuthToken.deleteMany({ userId: user._id }),
      Usage.deleteMany({ subject: user._id }),
    ]);
    await User.deleteOne({ _id: user._id });
    clearAuthCookies(config, res);
    res.json({ ok: true });
  });

  // ── Saved files ────────────────────────────────────────────────────────
  router.get('/files', requireUser, async (req, res) => {
    const files = await SavedFile.find({ ownerId: req.user!._id }).sort({ createdAt: -1 }).lean();
    res.json({ files: files.map((f) => fileInfo(f as Record<string, unknown>)) });
  });

  router.post('/files', requireUser, async (req, res) => {
    const body = parseBody(saveFileSchema, req.body);
    const user = req.user!;
    const job = await ownJob(req, body.jobId);
    if (job.output.status !== 'done' || !job.output.fileName)
      throw new HttpError(
        409,
        'not_ready',
        'Build the cleaned file first (Download), then save it',
      );
    const size = job.output.size ?? 0;
    // Reserve the space atomically, so two saves can't both squeeze past the limit.
    const reserved = await User.findOneAndUpdate(
      { _id: user._id, storageUsedBytes: { $lte: config.limits.userStorageBytes - size } },
      { $inc: { storageUsedBytes: size } },
      { returnDocument: 'after' },
    );
    if (!reserved)
      throw new HttpError(
        413,
        'storage_full',
        `This would go over your ${Math.round(config.limits.userStorageBytes / 1024 / 1024)} MB of saved files. Delete some first.`,
      );
    const id = newId();
    const key = `users/${user._id}/files/${id}`;
    try {
      await storage.copy(
        { bucket: 'outputs', key: keys.output(job.prefix) },
        { bucket: 'outputs', key },
      );
      const f = await SavedFile.create({
        _id: id,
        ownerId: user._id,
        jobId: job._id,
        name: job.output.fileName,
        key,
        size,
        format: job.input.format,
      });
      res.status(201).json({ file: fileInfo(f.toObject() as Record<string, unknown>) });
    } catch (e) {
      await User.updateOne({ _id: user._id }, { $inc: { storageUsedBytes: -size } });
      throw e;
    }
  });

  router.get('/files/:id/download', requireUser, async (req: Request<{ id: string }>, res) => {
    const f = await SavedFile.findOne({ _id: req.params.id, ownerId: req.user!._id }).lean();
    if (!f) throw notFound('File not found');
    const url = await storage.signDownload('outputs', f.key, { fileName: f.name });
    res.set('Cache-Control', 'no-store').json({ url });
  });

  router.delete('/files/:id', requireUser, async (req: Request<{ id: string }>, res) => {
    const f = await SavedFile.findOneAndDelete({
      _id: req.params.id,
      ownerId: req.user!._id,
    }).lean();
    if (!f) throw notFound('File not found');
    await storage.delete('outputs', f.key);
    await User.updateOne({ _id: req.user!._id }, { $inc: { storageUsedBytes: -f.size } });
    res.json({ ok: true });
  });

  // ── Rules ──────────────────────────────────────────────────────────────
  router.get('/rules', requireUser, async (req, res) => {
    const rules = await Rule.find({ ownerId: req.user!._id })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    res.json({ rules: rules.map((r) => ruleInfo(r as Record<string, unknown>)) });
  });

  router.post('/rules', requireUser, async (req, res) => {
    const body = parseBody(ruleSchema, req.body);
    const count = await Rule.countDocuments({ ownerId: req.user!._id });
    if (count >= MAX_RULES)
      throw new HttpError(400, 'too_many_rules', `You can have up to ${MAX_RULES} rules`);
    const r = await Rule.create({
      ...body,
      to: body.kind === 'keep' ? '' : body.to,
      ownerId: req.user!._id,
      order: count,
    });
    res.status(201).json({ rule: ruleInfo(r.toObject() as Record<string, unknown>) });
  });

  router.patch('/rules/:id', requireUser, async (req: Request<{ id: string }>, res) => {
    const body = parseBody(updateRuleSchema, req.body);
    if (body.kind === 'keep') body.to = '';
    const r = await Rule.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user!._id },
      { $set: body },
      { returnDocument: 'after' },
    ).lean();
    if (!r) throw notFound('Rule not found');
    res.json({ rule: ruleInfo(r as Record<string, unknown>) });
  });

  router.delete('/rules/:id', requireUser, async (req: Request<{ id: string }>, res) => {
    const r = await Rule.findOneAndDelete({ _id: req.params.id, ownerId: req.user!._id }).lean();
    if (!r) throw notFound('Rule not found');
    res.json({ ok: true });
  });

  // ── History ────────────────────────────────────────────────────────────
  router.get('/history', requireUser, async (req, res) => {
    const before = typeof req.query['before'] === 'string' ? new Date(req.query['before']) : null;
    const filter: Record<string, unknown> = {
      ownerId: req.user!._id,
      status: { $ne: 'uploading' },
    };
    if (before && !Number.isNaN(before.getTime())) filter['createdAt'] = { $lt: before };
    const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(21).lean<JobDoc[]>();
    const saved = new Set(
      (await SavedFile.find({ jobId: { $in: jobs.map((j) => j._id) } }, { jobId: 1 }).lean()).map(
        (f) => f.jobId,
      ),
    );
    const page = jobs.slice(0, 20);
    res.json({
      jobs: page.map((j) => jobInfo(j, saved.has(j._id))),
      next: jobs.length > 20 ? jobInfo(page[page.length - 1]!).createdAt : null,
    });
  });

  router.delete('/history/:id', requireUser, async (req: Request<{ id: string }>, res) => {
    const job = await ownJob(req, req.params.id);
    await deleteJobFiles(storage, job.prefix);
    await Job.deleteOne({ _id: job._id });
    cache.drop(job._id);
    res.json({ ok: true });
  });

  return router;
}
