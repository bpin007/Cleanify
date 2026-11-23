/** Secondary cleanup (correction 5): expired jobs and old anon/ and api/ files go; users/ stays. */
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupExpired } from '../src/jobs/work';
import { Job } from '../src/models';
import { makeApp, useDatabase } from './helpers';

useDatabase();
const t = makeApp();
afterAll(() => t.cleanup());

const age = async (bucket: 'uploads' | 'outputs', key: string, minutes: number) => {
  const when = new Date(Date.now() - minutes * 60_000);
  await utimes(join(t.config.localStorageDir, bucket, ...key.split('/')), when, when);
};

describe('cleanup-expired', () => {
  it('removes expired jobs with their files and leaves the rest', async () => {
    const put = (bucket: 'uploads' | 'outputs', key: string) =>
      t.storage.put(bucket, key, new Uint8Array([1]), 'application/octet-stream');
    await Job.create({
      _id: 'old',
      prefix: 'anon/s1/old',
      status: 'done',
      input: { kind: 'text' },
      expiresAt: new Date(Date.now() - 1000),
    });
    await Job.create({
      _id: 'fresh',
      prefix: 'anon/s1/fresh',
      status: 'done',
      input: { kind: 'text' },
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await Job.create({
      _id: 'mine',
      ownerId: 'u1',
      prefix: 'users/u1/mine',
      status: 'done',
      input: { kind: 'text' },
    });
    await put('uploads', 'anon/s1/old/input');
    await put('outputs', 'anon/s1/old/output');
    await put('uploads', 'anon/s1/fresh/input');
    await put('uploads', 'users/u1/mine/input');
    // An orphan anonymous upload older than an hour, an API file older than 24 h, and
    // a signed-in user's file that is a year old.
    await put('uploads', 'anon/s2/orphan/input');
    await age('uploads', 'anon/s2/orphan/input', 61);
    await put('outputs', 'api/k1/j1/output');
    await age('outputs', 'api/k1/j1/output', 25 * 60);
    await put('outputs', 'api/k1/j2/output');
    await age('outputs', 'api/k1/j2/output', 23 * 60);
    await age('uploads', 'users/u1/mine/input', 365 * 24 * 60);

    const r = await cleanupExpired({ config: t.config, storage: t.storage, log: () => {} });
    expect(r).toEqual({ jobs: 1, objects: 2 });
    expect((await Job.find().lean()).map((j) => j._id).sort()).toEqual(['fresh', 'mine']);
    expect((await t.storage.list('uploads', '')).map((o) => o.key)).toEqual([
      'anon/s1/fresh/input',
      'users/u1/mine/input',
    ]);
    expect((await t.storage.list('outputs', '')).map((o) => o.key)).toEqual(['api/k1/j2/output']);

    // Running it again changes nothing (idempotent).
    expect(await cleanupExpired({ config: t.config, storage: t.storage, log: () => {} })).toEqual({
      jobs: 0,
      objects: 0,
    });
  });

  it('is registered as a job', async () => {
    await expect(t.queue.run('cleanup-expired')).resolves.toBeUndefined();
  });
});
