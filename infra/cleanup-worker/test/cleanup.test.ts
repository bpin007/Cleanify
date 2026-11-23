/** Cleanup tests (PROJECT.md section 20): anon/ > 1 h and api/ > 24 h go; users/ never. */
import { describe, expect, it } from 'vitest';
import { cleanBucket, retentionFrom, type Bucket } from '../src/cleanup';
import worker from '../src/index';

const NOW = new Date('2026-11-24T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A fake R2 bucket with paged listings, like the real binding. */
function fakeBucket(objects: Record<string, Date>, pageSize = 2) {
  const store = new Map(Object.entries(objects));
  const deletes: string[][] = [];
  const bucket: Bucket = {
    async list({ prefix, cursor }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      return {
        objects: page.map((key) => ({ key, uploaded: store.get(key)! })),
        truncated,
        ...(truncated ? { cursor: String(start + pageSize) } : {}),
      };
    },
    async delete(keys) {
      deletes.push(keys);
      for (const k of keys) store.delete(k);
    },
  };
  return { bucket, store, deletes };
}

describe('cleanBucket', () => {
  it('deletes only expired anon/ and api/ objects, across pages', async () => {
    const { bucket, store } = fakeBucket({
      'anon/s1/j1/input': ago(61),
      'anon/s1/j1/output': ago(90),
      'anon/s2/j2/input': ago(59),
      'api/k1/j1/input': ago(25 * 60),
      'api/k1/j2/input': ago(23 * 60),
      'users/u1/j1/input': ago(365 * 24 * 60),
      'users/u1/files/f1': ago(10_000_000),
    });
    const r = await cleanBucket(bucket, { anonMinutes: 60, apiHours: 24 }, NOW);
    expect(r).toEqual({ scanned: 5, deleted: 3 });
    expect([...store.keys()].sort()).toEqual([
      'anon/s2/j2/input',
      'api/k1/j2/input',
      'users/u1/files/f1',
      'users/u1/j1/input',
    ]);
  });

  it('is idempotent and never lists users/', async () => {
    const { bucket, deletes } = fakeBucket({ 'users/a': ago(1e9), 'anon/x': ago(1) });
    const listed: string[] = [];
    const spy: Bucket = {
      list: (o) => (listed.push(o.prefix), bucket.list(o)),
      delete: (k) => bucket.delete(k),
    };
    await cleanBucket(spy, { anonMinutes: 60, apiHours: 24 }, NOW);
    await cleanBucket(spy, { anonMinutes: 60, apiHours: 24 }, NOW);
    expect(deletes).toEqual([]);
    expect(new Set(listed)).toEqual(new Set(['anon/', 'api/']));
  });

  it('uses the configured retention', async () => {
    const { bucket, store } = fakeBucket({ 'anon/a': ago(31), 'anon/b': ago(29) });
    await cleanBucket(bucket, { anonMinutes: 30, apiHours: 24 }, NOW);
    expect([...store.keys()]).toEqual(['anon/b']);
  });
});

describe('retentionFrom', () => {
  it('reads Worker variables, falling back to 60 minutes and 24 hours', () => {
    expect(retentionFrom({})).toEqual({ anonMinutes: 60, apiHours: 24 });
    expect(retentionFrom({ ANON_RETENTION_MINUTES: '15', API_RETENTION_HOURS: '2' })).toEqual({
      anonMinutes: 15,
      apiHours: 2,
    });
    expect(retentionFrom({ ANON_RETENTION_MINUTES: 'nope' }).anonMinutes).toBe(60);
  });
});

describe('scheduled handler', () => {
  it('cleans both buckets', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    const up = fakeBucket({ 'anon/a': old });
    const out = fakeBucket({ 'anon/b': old, 'users/c': old });
    const waits: Promise<unknown>[] = [];
    await worker.scheduled(
      {} as ScheduledController,
      { UPLOADS: up.bucket as unknown as R2Bucket, OUTPUTS: out.bucket as unknown as R2Bucket },
      { waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext,
    );
    await Promise.all(waits);
    expect([...up.store.keys()]).toEqual([]);
    expect([...out.store.keys()]).toEqual(['users/c']);
  });
});
