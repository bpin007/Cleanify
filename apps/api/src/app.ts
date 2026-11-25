import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { JobQueue } from './jobs/queue.js';
import {
  JOBS,
  SessionCache,
  buildOutput,
  cleanupExpired,
  processJob,
  type WorkDeps,
} from './jobs/work.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { limiter } from './middleware/rateLimit.js';
import { csrf, readAnon, readUser } from './middleware/session.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { realGoogleClient, type GoogleClient } from './routes/google.js';
import { healthRouter } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import type { EmailService } from './services/email.js';
import { LocalStorage, type StorageService } from './services/storage/index.js';

export interface AppDeps {
  config: Config;
  storage: StorageService;
  email: EmailService;
  queue: JobQueue;
  /** Defaults to the real Google client when credentials are configured. */
  google?: GoogleClient | null;
  log?: (msg: string, e?: unknown) => void;
}

/**
 * Builds the Express app without starting a server, so tests can drive it with
 * Supertest. Security (PROJECT.md section 17): helmet headers, first-party cookies only
 * (no CORS: the browser reaches the API through the web origin, correction 6), CSRF
 * double-submit token, MongoDB-backed rate limits, Zod validation on every body.
 */
export function createApp(deps: AppDeps): Express {
  const { config, storage, queue } = deps;
  const log = deps.log ?? ((msg: string, e?: unknown) => console.error(msg, e ?? ''));
  const google =
    deps.google !== undefined
      ? deps.google
      : config.google
        ? realGoogleClient(config.google.clientId, config.google.clientSecret)
        : null;

  const work: WorkDeps = { config, storage, log };
  const cache = new SessionCache();
  queue.define(JOBS.process, (d) => processJob(work, cache, String(d['jobId'])));
  queue.define(JOBS.output, (d) =>
    buildOutput(work, cache, String(d['jobId']), Number(d['version'])),
  );
  queue.define(JOBS.cleanup, async () => {
    const r = await cleanupExpired(work);
    if (r.jobs || r.objects) log(`[jobs] cleanup removed ${r.jobs} jobs and ${r.objects} files`);
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cookieParser());

  // Signed local-storage URLs carry their own authorisation (HMAC) and a raw body.
  if (storage instanceof LocalStorage) app.use('/api/storage/local', storage.router());

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', healthRouter(config));
  app.use('/api', csrf(config), readUser(config), readAnon(config));
  app.use('/api', limiter('api', config.env === 'test' ? 10_000 : 300));
  app.use('/api/auth', authRoutes({ config, email: deps.email, google, log }));
  app.use('/api', jobRoutes({ config, work, queue, cache }));
  app.use('/api', accountRoutes({ config, work, cache, googleEnabled: google !== null }));

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
