/** Storage adapters, config rules, rate-limit store and Agenda on a real MongoDB. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { AgendaQueue } from '../src/jobs/queue';
import { MongoStore } from '../src/middleware/rateLimit';
import { LocalStorage, R2Storage, attachment, createStorage } from '../src/services/storage';
import { useDatabase } from './helpers';

useDatabase();

describe('local storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanify-ls-'));
  let now = 1_000_000;
  const s = new LocalStorage(dir, 'secret', 'http://web.test/api', () => now);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stores, lists, copies and deletes by prefix', async () => {
    await s.put('uploads', 'anon/a/1/input', new Uint8Array([1, 2]));
    await s.put('uploads', 'anon/a/2/input', new Uint8Array([3]));
    await s.copy({ bucket: 'uploads', key: 'anon/a/1/input' }, { bucket: 'outputs', key: 'x/y' });
    expect(await s.get('outputs', 'x/y')).toEqual(new Uint8Array([1, 2]));
    expect((await s.list('uploads', 'anon/a/')).map((o) => [o.key, o.size])).toEqual([
      ['anon/a/1/input', 2],
      ['anon/a/2/input', 1],
    ]);
    expect(await s.head('uploads', 'missing')).toBeNull();
    expect(await s.deletePrefix('uploads', 'anon/a/')).toBe(2);
    expect(await s.list('uploads', '')).toEqual([]);
  });

  it('never lets a key escape its bucket folder', async () => {
    await expect(s.put('uploads', '../../evil', new Uint8Array([1]))).rejects.toThrow(
      'Invalid key',
    );
    await expect(s.get('outputs', '../uploads/x')).rejects.toThrow('Invalid key');
  });

  it('signs URLs that expire and only work for their method', async () => {
    const up = await s.signUpload('uploads', 'k', {
      contentType: 'application/octet-stream',
      maxBytes: 5,
    });
    const token = up.url.split('/').pop()!;
    expect(s.verify(token, 'PUT')).toMatchObject({ b: 'uploads', k: 'k', max: 5 });
    expect(() => s.verify(token, 'GET')).toThrow('Invalid link');
    expect(() => s.verify(`${token.split('.')[0]}.forged`, 'PUT')).toThrow('Invalid link');
    now += 11 * 60_000;
    expect(() => s.verify(token, 'PUT')).toThrow('expired');
  });
});

describe('R2 storage', () => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const client = {
    config: {},
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'ListObjectsV2Command')
        return {
          Contents: [{ Key: 'anon/a', Size: 3, LastModified: new Date(0) }],
          IsTruncated: false,
        };
      return {};
    },
  };
  const s = new R2Storage({
    accountId: 'acct',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret',
    buckets: { uploads: 'up-bucket', outputs: 'out-bucket' },
    client: client as never,
  });

  it('uses the right bucket names and batches deletes', async () => {
    await s.put('uploads', 'k', new Uint8Array([1]), 'text/plain');
    expect(sent.at(-1)).toMatchObject({
      name: 'PutObjectCommand',
      input: { Bucket: 'up-bucket', Key: 'k' },
    });
    expect(await s.deletePrefix('outputs', 'anon/')).toBe(1);
    expect(sent.at(-1)).toMatchObject({
      name: 'DeleteObjectsCommand',
      input: { Bucket: 'out-bucket', Delete: { Objects: [{ Key: 'anon/a' }] } },
    });
    await s.copy({ bucket: 'outputs', key: 'a b' }, { bucket: 'outputs', key: 'c' });
    expect(sent.at(-1)!.input).toMatchObject({ CopySource: 'out-bucket/a%20b' });
  });

  it('presigns uploads and downloads for 10 minutes against the account endpoint', async () => {
    const real = new R2Storage({
      accountId: 'acct',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      buckets: { uploads: 'up-bucket', outputs: 'out-bucket' },
    });
    const up = await real.signUpload('uploads', 'anon/s/j/input', {
      contentType: 'application/octet-stream',
      maxBytes: 10,
    });
    const u = new URL(up.url);
    expect(u.host).toBe('up-bucket.acct.r2.cloudflarestorage.com');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    const down = new URL(await real.signDownload('outputs', 'k', { fileName: 'café.csv' }));
    expect(down.searchParams.get('response-content-disposition')).toBe(attachment('café.csv'));
  });
});

describe('config', () => {
  it('works with an empty environment in development, with random secrets', () => {
    const warnings: string[] = [];
    const c = loadConfig({}, (w) => warnings.push(w));
    expect(c.env).toBe('development');
    expect(c.secrets.access).toHaveLength(43);
    expect(warnings.length).toBe(3);
    expect(createStorage(c).kind).toBe('local');
  });

  it('refuses to start in production without real secrets, database and R2', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    const base = {
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://x',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      ANON_SESSION_SECRET: 'c'.repeat(32),
    };
    expect(() => loadConfig(base)).toThrow('R2 must be configured');
    const r2 = { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c' };
    expect(() => loadConfig({ ...base, ...r2, JWT_ACCESS_SECRET: 'short' })).toThrow('at least 32');
    const c = loadConfig({ ...base, ...r2 });
    expect(createStorage(c).kind).toBe('r2');
  });

  it('wants all R2 or Google values together', () => {
    expect(() => loadConfig({ R2_ACCOUNT_ID: 'a' })).toThrow('or none');
    expect(() => loadConfig({ GOOGLE_CLIENT_ID: 'a' })).toThrow('or neither');
    expect(
      loadConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }, () => {}).google,
    ).toEqual({
      clientId: 'a',
      clientSecret: 'b',
    });
  });

  it('reads limits and retention from the environment', () => {
    const c = loadConfig({ ANON_RETENTION_MINUTES: '30', USER_CLOUD_FILE_MB: '5' }, () => {});
    expect(c.retention.anonMinutes).toBe(30);
    expect(c.limits.userFileBytes).toBe(5 * 1024 * 1024);
  });
});

describe('rate-limit store', () => {
  it('counts hits in a window and starts a new window when it ends', async () => {
    const store = new MongoStore('t');
    store.init({ windowMs: 200 } as never);
    expect((await store.increment('ip')).totalHits).toBe(1);
    expect((await store.increment('ip')).totalHits).toBe(2);
    await store.decrement('ip');
    expect((await store.increment('ip')).totalHits).toBe(2);
    await new Promise((r) => setTimeout(r, 250));
    expect((await store.increment('ip')).totalHits).toBe(1);
    await store.resetKey('ip');
    expect((await store.increment('ip')).totalHits).toBe(1);
  });
});

describe('Agenda queue', () => {
  it('runs an enqueued job from MongoDB', async () => {
    const q = new AgendaQueue(mongoose.connection, () => {});
    const seen: unknown[] = [];
    const done = new Promise<void>((resolve) => {
      q.define('hello', async (data) => {
        seen.push(data);
        resolve();
      });
    });
    await q.start();
    await q.enqueue('hello', { jobId: 'j1' });
    await done;
    await q.stop();
    expect(seen).toEqual([{ jobId: 'j1' }]);
  }, 30_000);
});
