import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { readWorkbook } from '@cleanify/engine';
import { contentMatches } from '../src/routes/jobs';
import { Job } from '../src/models';
import { makeApp, pathOf, SETTINGS, signedIn, useDatabase, type Agent } from './helpers';

useDatabase();
const t = makeApp({
  limits: { ...makeApp().config.limits, anonJobsPerDay: 3, anonFileBytes: 64 * 1024 },
});
afterAll(() => t.cleanup());

const fixture = (name: string) =>
  readFileSync(new URL(`../../web/e2e/fixtures/${name}`, import.meta.url));

/** Uploads through the signed URL and starts the job, like the browser does. */
async function uploadAndStart(a: Agent, fileName: string, bytes: Buffer) {
  const ticket = await a.post('/api/uploads').send({ fileName, size: bytes.length });
  if (ticket.status !== 201) return { ticket, start: null };
  const put = await a
    .put(pathOf(ticket.body.upload.url))
    .set('Content-Type', 'application/octet-stream')
    .send(bytes);
  expect(put.status).toBe(200);
  const start = await a.post('/api/jobs').send({ jobId: ticket.body.jobId, settings: SETTINGS });
  return { ticket, start };
}

async function finished(a: Agent, id: string) {
  await t.queue.idle();
  return (await a.get(`/api/jobs/${id}`)).body;
}

describe('anonymous text job', () => {
  it('analyses, takes decisions, builds the output and downloads it', async () => {
    const a = await t.agent();
    const start = await a
      .post('/api/jobs')
      .send({ text: 'donâ€™t panic, cafÃ© ok', settings: SETTINGS });
    expect(start.status).toBe(202);
    expect(([] as string[]).concat(start.headers['set-cookie'] ?? []).join(';')).toMatch(
      /cl_anon=/,
    );
    const id = start.body.id;

    const job = await finished(a, id);
    expect(job).toMatchObject({ status: 'done', summary: { encoding: 2, total: 2 } });
    expect(new Date(job.expiresAt).getTime() - Date.now()).toBeGreaterThan(59 * 60_000);

    const result = await a.get(`/api/jobs/${id}/result`);
    expect(result.status).toBe(200);
    expect(result.body.original).toBe('donâ€™t panic, cafÃ© ok');
    expect(result.body.changes).toHaveLength(2);

    const view = await a.post(`/api/jobs/${id}/decide`).send({
      decisions: [{ type: 'one', id: result.body.changes[1].id, accepted: false }],
    });
    expect(view.body.applied).toEqual([true, false]);
    // The result now reflects the decision.
    expect((await a.get(`/api/jobs/${id}/result`)).body.applied).toEqual([true, false]);

    const apply = await a.post(`/api/jobs/${id}/apply`).send({ encoding: 'utf-8', bomCount: 0 });
    expect(apply.status).toBe(202);
    const built = await finished(a, id);
    expect(built.output).toMatchObject({ status: 'done', fileName: 'cleaned.txt' });

    const dl = await a.get(`/api/jobs/${id}/download`);
    const file = await a.get(pathOf(dl.body.url)).buffer(true);
    expect(file.headers['content-disposition']).toMatch(/filename="cleaned.txt"/);
    expect(file.body.toString('utf8')).toBe('don’t panic, cafÃ© ok');
  });

  it('blocks an output that would lose characters, listing them', async () => {
    const a = await t.agent();
    const { body } = await a.post('/api/jobs').send({ text: 'ok 中', settings: SETTINGS });
    await finished(a, body.id);
    await a.post(`/api/jobs/${body.id}/apply`).send({ encoding: 'windows-1252', bomCount: 0 });
    const job = await finished(a, body.id);
    expect(job.output.status).toBe('blocked');
    expect(job.output.blockedChars).toEqual([{ char: '中', line: 1, column: 4 }]);
    expect((await a.get(`/api/jobs/${body.id}/download`)).status).toBe(409);
  });

  it('hides jobs from everyone but their owner', async () => {
    const a = await t.agent();
    const { body } = await a.post('/api/jobs').send({ text: 'cafÃ©', settings: SETTINGS });
    const other = await t.agent();
    expect((await other.get(`/api/jobs/${body.id}`)).status).toBe(404);
    const user = await signedIn(t, 'eve@example.com');
    expect((await user.get(`/api/jobs/${body.id}/result`)).status).toBe(404);
  });
});

describe('file jobs', () => {
  it('cleans an uploaded CSV through the signed upload URL', async () => {
    const a = await t.agent();
    const { start } = await uploadAndStart(a, 'customers.csv', fixture('customers.csv'));
    expect(start!.status).toBe(202);
    const job = await finished(a, start!.body.id);
    expect(job.status).toBe('done');
    expect(job.input).toMatchObject({ kind: 'file', fileName: 'customers.csv', format: 'csv' });
    await a.post(`/api/jobs/${job.id}/apply`).send({ encoding: 'utf-8', bomCount: 0 });
    const built = await finished(a, job.id);
    expect(built.output.fileName).toBe('customers-clean.csv');
    const dl = await a.get(`/api/jobs/${job.id}/download`);
    const out = (await a.get(pathOf(dl.body.url)).buffer(true)).body.toString('utf8');
    expect(out).toContain('"García, José",München');
  });

  it('cleans a workbook on the server and returns .xlsx', async () => {
    const user = await signedIn(t, 'xl@example.com');
    const { start } = await uploadAndStart(user, 'formulas.xlsx', fixture('formulas.xlsx'));
    const job = await finished(user, start!.body.id);
    expect(job.status).toBe('done');
    expect(job.expiresAt).toBeNull();
    await user.post(`/api/jobs/${job.id}/apply`).send({ encoding: 'utf-8', bomCount: 0 });
    const built = await finished(user, job.id);
    expect(built.output.fileName).toBe('formulas-clean.xlsx');
    const dl = await user.get(`/api/jobs/${job.id}/download`);
    const bytes = (await user.get(pathOf(dl.body.url)).buffer(true)).body as Buffer;
    const doc = await readWorkbook(new Uint8Array(bytes), 'xlsx');
    expect(doc.cells.find((c) => c.address === 'A2')?.value).toBe('café');
  });

  it('refuses files that are too big, of an unknown type, or whose content lies', async () => {
    const a = await t.agent();
    const big = await a.post('/api/uploads').send({ fileName: 'a.csv', size: 65 * 1024 });
    expect(big.status).toBe(413);
    expect(big.body.error.message).toMatch(
      /up to 0 MB \(more when logged in\)|more when logged in/,
    );
    expect((await a.post('/api/uploads').send({ fileName: 'a.exe', size: 10 })).status).toBe(400);

    const { start } = await uploadAndStart(a, 'fake.xlsx', Buffer.from('just text, not a zip'));
    expect(start!.status).toBe(400);
    expect(start!.body.error.code).toBe('content_mismatch');
  });

  it("won't start a job whose file was never uploaded", async () => {
    const a = await t.agent();
    const ticket = await a.post('/api/uploads').send({ fileName: 'x.txt', size: 5 });
    const r = await a.post('/api/jobs').send({ jobId: ticket.body.jobId, settings: SETTINGS });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('not_uploaded');
  });

  it('rejects an upload larger than the signed limit while it streams', async () => {
    const a = await t.agent();
    const ticket = await a.post('/api/uploads').send({ fileName: 'x.txt', size: 10 });
    const put = await a.put(pathOf(ticket.body.upload.url)).send(Buffer.alloc(70 * 1024, 0x61));
    expect(put.status).toBe(413);
  });
});

describe('quotas', () => {
  it('limits anonymous cloud jobs per day', async () => {
    const a = await t.agent();
    for (let i = 0; i < 3; i++)
      expect((await a.post('/api/jobs').send({ text: `x${i}`, settings: SETTINGS })).status).toBe(
        202,
      );
    const fourth = await a.post('/api/jobs').send({ text: 'x', settings: SETTINGS });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.message).toMatch(/Log in for more/);
    expect((await a.get('/api/me')).body.quotas).toMatchObject({
      cloudJobsPerDay: 3,
      cloudJobsToday: 3,
    });
    await t.queue.idle();
  });
});

describe('deleting a job', () => {
  it('removes the record and its files', async () => {
    const a = await t.agent();
    const { body } = await a.post('/api/jobs').send({ text: 'cafÃ©', settings: SETTINGS });
    await finished(a, body.id);
    const job = await Job.findById(body.id).lean();
    expect((await t.storage.list('uploads', job!.prefix)).length).toBe(1);
    expect((await a.delete(`/api/jobs/${body.id}`)).status).toBe(200);
    expect(await Job.findById(body.id)).toBeNull();
    expect(await t.storage.list('uploads', job!.prefix)).toEqual([]);
    expect(await t.storage.list('outputs', job!.prefix)).toEqual([]);
  });
});

describe('content check', () => {
  it('matches file types by their first bytes', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const accdb = new Uint8Array([0, 1, 0, 0, ...new TextEncoder().encode('Standard ACE DB'), 0]);
    expect(contentMatches('a.xlsx', zip)).toBe(true);
    expect(contentMatches('a.ods', zip)).toBe(true);
    expect(contentMatches('a.xls', ole)).toBe(true);
    expect(contentMatches('a.xls', zip)).toBe(false);
    expect(contentMatches('a.accdb', accdb)).toBe(true);
    expect(contentMatches('a.csv', zip)).toBe(false);
    expect(contentMatches('a.txt', new Uint8Array([0xff, 0xfe, 0x41, 0]))).toBe(true);
  });
});

describe('custom rules in cloud jobs (section 5)', () => {
  const ASCII = { ...SETTINGS, ascii: true };

  /** Runs a text job to the end and returns the downloaded output and the changes. */
  async function cleaned(a: Agent, text: string, settings: object) {
    const { body } = await a.post('/api/jobs').send({ text, settings });
    expect((await finished(a, body.id)).status).toBe('done');
    const result = await a.get(`/api/jobs/${body.id}/result`);
    await a.post(`/api/jobs/${body.id}/apply`).send({ encoding: 'utf-8', bomCount: 0 });
    await finished(a, body.id);
    const dl = await a.get(`/api/jobs/${body.id}/download`);
    const file = await a.get(pathOf(dl.body.url)).buffer(true);
    return {
      id: body.id as string,
      text: file.body.toString('utf8'),
      changes: result.body.changes as { id: string; stage: string; reason: string }[],
    };
  }

  it('applies a signed-in user’s saved, enabled rules in order, and ignores rules in the body', async () => {
    const a = await signedIn(t, 'rules-jobs@example.com');
    await a.post('/api/rules').send({ name: 'TM plain', from: '™', to: 'TM' });
    await a.post('/api/rules').send({ name: 'TM brackets', from: '™', to: '[TM]' });
    await a.post('/api/rules').send({ kind: 'keep', name: 'keep é', from: 'é' });
    await a.post('/api/rules').send({ name: 'off', from: 'Acme', to: 'X', enabled: false });

    const r = await cleaned(a, 'Acme™ Café naïve', {
      ...ASCII,
      rules: { replace: [{ name: 'sent', from: 'Acme', to: 'Y' }] },
    });
    expect(r.text).toBe('AcmeTM Café naive');
    expect(r.changes.filter((c) => c.stage === 'rule').map((c) => c.reason)).toEqual(['TM plain']);
  });

  it('a rule change can be rejected like any other change', async () => {
    const a = await signedIn(t, 'rules-reject@example.com');
    await a.post('/api/rules').send({ name: 'TM plain', from: '™', to: 'TM' });
    const { body } = await a.post('/api/jobs').send({ text: 'Acme™', settings: ASCII });
    await finished(a, body.id);
    const result = await a.get(`/api/jobs/${body.id}/result`);
    const rule = result.body.changes.find((c: { stage: string }) => c.stage === 'rule');
    await a.post(`/api/jobs/${body.id}/decide`).send({
      decisions: [{ type: 'group', stage: 'rule', accepted: false }],
    });
    expect(rule).toBeDefined();
    await a.post(`/api/jobs/${body.id}/apply`).send({ encoding: 'utf-8', bomCount: 0 });
    await finished(a, body.id);
    const dl = await a.get(`/api/jobs/${body.id}/download`);
    expect((await a.get(pathOf(dl.body.url)).buffer(true)).body.toString('utf8')).toBe('Acme(TM)');
  });

  it('anonymous users send their session-only rules with the job', async () => {
    const a = await t.agent();
    const r = await cleaned(a, 'Acme™ Café', {
      ...ASCII,
      rules: {
        replace: [{ name: 'TM plain', from: '™', to: 'TM' }],
        keep: [{ name: 'k', text: 'é' }],
      },
    });
    expect(r.text).toBe('AcmeTM Café');
  });

  it('refuses rule sets that break the limits', async () => {
    const a = await t.agent();
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ name: `r${i}`, from: 'a', to: 'b' }));
    const r = await a
      .post('/api/jobs')
      .send({ text: 'x', settings: { ...SETTINGS, rules: { replace: tooMany } } });
    expect(r.status).toBe(400);
  });
});
