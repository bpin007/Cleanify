import { afterAll, describe, expect, it } from 'vitest';
import { AuthToken, Job, Rule, SavedFile, Session, User } from '../src/models';
import { makeApp, pathOf, SETTINGS, signedIn, useDatabase, type Agent } from './helpers';

useDatabase();
const t = makeApp({ limits: { ...makeApp().config.limits, userStorageBytes: 60 } });
afterAll(() => t.cleanup());

/** A finished text job with its output built. */
async function builtJob(a: Agent, text: string) {
  const { body } = await a.post('/api/jobs').send({ text, settings: SETTINGS });
  await t.queue.idle();
  await a.post(`/api/jobs/${body.id}/apply`).send({ encoding: 'utf-8', bomCount: 0 });
  await t.queue.idle();
  return body.id as string;
}

describe('/api/me', () => {
  it('shows anonymous quotas, then signed-in quotas and settings', async () => {
    const anon = await t.agent();
    const me = await anon.get('/api/me');
    expect(me.body).toMatchObject({
      user: null,
      quotas: {
        cloudFileBytes: 10 * 1024 * 1024,
        cloudJobsPerDay: 10,
        retentionMinutes: 60,
        storageBytes: null,
      },
    });
    const a = await signedIn(t, 'me@example.com');
    const patched = await a.patch('/api/me').send({
      name: 'Me',
      settings: { theme: 'dark', defaultStages: { ...SETTINGS, ascii: true } },
    });
    expect(patched.body.user).toMatchObject({
      name: 'Me',
      settings: { theme: 'dark', defaultStages: { ascii: true } },
    });
    expect((await a.get('/api/me')).body.quotas).toMatchObject({
      cloudJobsPerDay: 100,
      retentionMinutes: null,
    });
  });

  it('needs a login for account routes', async () => {
    const anon = await t.agent();
    for (const path of ['/api/files', '/api/rules', '/api/history'])
      expect((await anon.get(path)).status).toBe(401);
    expect((await anon.patch('/api/me').send({ name: 'x' })).status).toBe(401);
  });
});

describe('saved files', () => {
  it('saves a built output, lists it, downloads it and deletes it, counting storage', async () => {
    const a = await signedIn(t, 'files@example.com');
    const jobId = await builtJob(a, 'cafÃ©');
    const saved = await a.post('/api/files').send({ jobId });
    expect(saved.status).toBe(201);
    expect(saved.body.file).toMatchObject({ name: 'cleaned.txt', size: 5, format: 'text' });
    expect((await a.get('/api/me')).body.user.storageUsedBytes).toBe(5);
    expect((await a.get('/api/files')).body.files).toHaveLength(1);
    expect((await a.get(`/api/jobs/${jobId}`)).body.saved).toBe(true);

    const dl = await a.get(`/api/files/${saved.body.file.id}/download`);
    expect((await a.get(pathOf(dl.body.url)).buffer(true)).body.toString()).toBe('café');

    expect((await a.delete(`/api/files/${saved.body.file.id}`)).status).toBe(200);
    expect((await a.get('/api/me')).body.user.storageUsedBytes).toBe(0);
    // The saved copy is gone; the job's own analysis and output stay with the job.
    expect((await t.storage.list('outputs', 'users/')).map((o) => o.key.split('/').pop())).toEqual([
      'analysis.json.gz',
      'output',
    ]);
  });

  it('refuses to go over the storage limit', async () => {
    const a = await signedIn(t, 'full@example.com');
    const big = await builtJob(a, 'x'.repeat(50));
    expect((await a.post('/api/files').send({ jobId: big })).status).toBe(201);
    const more = await builtJob(a, 'y'.repeat(20));
    const r = await a.post('/api/files').send({ jobId: more });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('storage_full');
  });

  it("can't save someone else's job, or one without an output", async () => {
    const a = await signedIn(t, 'own1@example.com');
    const b = await signedIn(t, 'own2@example.com');
    const jobId = await builtJob(a, 'cafÃ©');
    expect((await b.post('/api/files').send({ jobId })).status).toBe(404);
    const { body } = await a.post('/api/jobs').send({ text: 'x', settings: SETTINGS });
    await t.queue.idle();
    expect((await a.post('/api/files').send({ jobId: body.id })).status).toBe(409);
  });
});

describe('rules', () => {
  it('creates, lists in order, updates and deletes rules', async () => {
    const a = await signedIn(t, 'rules@example.com');
    const r1 = await a.post('/api/rules').send({ name: 'Company', from: 'ACME Inc', to: 'ACME' });
    const r2 = await a
      .post('/api/rules')
      .send({ name: 'Dash', from: '--', to: '-', enabled: false });
    expect(r1.status).toBe(201);
    expect(r2.body.rule).toMatchObject({ order: 1, enabled: false });
    const patched = await a
      .patch(`/api/rules/${r2.body.rule.id}`)
      .send({ enabled: true, order: 0 });
    expect(patched.body.rule).toMatchObject({ enabled: true, order: 0 });
    await a.patch(`/api/rules/${r1.body.rule.id}`).send({ order: 1 });
    const list = await a.get('/api/rules');
    expect(list.body.rules.map((r: { name: string }) => r.name)).toEqual(['Dash', 'Company']);
    expect((await a.delete(`/api/rules/${r1.body.rule.id}`)).status).toBe(200);
    expect((await a.get('/api/rules')).body.rules).toHaveLength(1);
    // Rules are private.
    const b = await signedIn(t, 'rules2@example.com');
    expect((await b.delete(`/api/rules/${r2.body.rule.id}`)).status).toBe(404);
  });

  it('validates rules', async () => {
    const a = await signedIn(t, 'rules3@example.com');
    expect((await a.post('/api/rules').send({ name: '', from: 'x', to: 'y' })).status).toBe(400);
    expect((await a.post('/api/rules').send({ name: 'n', from: '', to: 'y' })).status).toBe(400);
  });
});

describe('history', () => {
  it('lists the user’s jobs newest first, 20 per page, and deletes one with its files', async () => {
    const a = await signedIn(t, 'hist@example.com');
    for (let i = 0; i < 22; i++)
      await a.post('/api/jobs').send({ text: `job ${i}`, settings: SETTINGS });
    await t.queue.idle();
    const first = await a.get('/api/history');
    expect(first.body.jobs).toHaveLength(20);
    expect(first.body.next).not.toBeNull();
    const second = await a.get(`/api/history?before=${encodeURIComponent(first.body.next)}`);
    expect(second.body.jobs).toHaveLength(2);
    expect(second.body.next).toBeNull();
    const id = second.body.jobs[0].id;
    expect((await a.delete(`/api/history/${id}`)).status).toBe(200);
    expect(await Job.findById(id)).toBeNull();
  });
});

describe('deleting the account', () => {
  it('needs the email typed again, then removes the user and everything they own', async () => {
    const a = await signedIn(t, 'bye@example.com');
    const jobId = await builtJob(a, 'cafÃ©');
    await a.post('/api/files').send({ jobId });
    await a.post('/api/rules').send({ name: 'r', from: 'a', to: 'b' });
    const user = await User.findOne({ email: 'bye@example.com' }).lean();

    expect((await a.delete('/api/me').send({ confirm: 'wrong@example.com' })).status).toBe(400);
    const res = await a.delete('/api/me').send({ confirm: 'bye@example.com' });
    expect(res.status).toBe(200);

    expect(await User.findById(user!._id)).toBeNull();
    for (const model of [Job, SavedFile, Rule])
      expect(await (model as typeof Job).countDocuments({ ownerId: user!._id })).toBe(0);
    expect(await Session.countDocuments({ userId: user!._id })).toBe(0);
    expect(await AuthToken.countDocuments({ userId: user!._id })).toBe(0);
    expect(await t.storage.list('uploads', `users/${user!._id}/`)).toEqual([]);
    expect(await t.storage.list('outputs', `users/${user!._id}/`)).toEqual([]);
    expect((await a.get('/api/me')).body.user).toBeNull();
  });
});
