import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { createApp } from '../src/app';
import { testConfig, type Config } from '../src/config';
import { InlineQueue } from '../src/jobs/queue';
import type { GoogleClient } from '../src/routes/google';
import { MemoryEmail } from '../src/services/email';
import { LocalStorage } from '../src/services/storage';

/** Connects this test file to its own database, emptied before each test. */
export function useDatabase() {
  beforeAll(async () => {
    const name = `t_${Math.random().toString(36).slice(2, 10)}`;
    await mongoose.connect(inject('mongoUri'), { dbName: name });
    await mongoose.connection.syncIndexes();
  });
  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  config: Config;
  email: MemoryEmail;
  queue: InlineQueue;
  storage: LocalStorage;
  logs: string[];
  /** A browser: keeps cookies and sends the CSRF header. */
  agent: () => Promise<Agent>;
  cleanup: () => void;
}

export type Agent = ReturnType<typeof request.agent> & { csrf: string };

export function makeApp(
  over: Partial<Config> = {},
  extra: { google?: GoogleClient | null } = {},
): TestApp {
  const dir = mkdtempSync(join(tmpdir(), 'cleanify-api-'));
  const config = testConfig({ webOrigin: 'http://web.test', localStorageDir: dir, ...over });
  const storage = new LocalStorage(dir, config.secrets.storage, 'http://web.test/api');
  const email = new MemoryEmail();
  const queue = new InlineQueue();
  const logs: string[] = [];
  const app = createApp({
    config,
    storage,
    email,
    queue,
    google: extra.google ?? null,
    log: (m, e) => logs.push(`${m} ${e ?? ''}`),
  });
  return {
    app,
    config,
    email,
    queue,
    storage,
    logs,
    async agent() {
      const a = request.agent(app) as Agent;
      const res = await a.get('/api/me');
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('cl_csrf='));
      a.csrf = decodeURIComponent(cookie!.split(';')[0]!.slice('cl_csrf='.length));
      a.set('x-csrf-token', a.csrf);
      return a;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** A signed-up, logged-in agent. */
export async function signedIn(
  t: TestApp,
  email = 'ana@example.com',
  password = 'correct horse battery',
) {
  const a = await t.agent();
  const r = await a.post('/api/auth/signup').send({ email, password });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  return a;
}

/** Path part of a signed local-storage URL (supertest talks to the app directly). */
export const pathOf = (url: string) => new URL(url).pathname + new URL(url).search;

export const SETTINGS = {
  repair: true,
  ascii: false,
  asciiScope: 'all',
  asciiOptions: { emoji: 'keep', nonLatin: 'keep' },
} as const;
