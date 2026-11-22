import express, { type Express } from 'express';
import { healthRouter } from './routes/health.js';

export interface AppConfig {
  appName: string;
  version: string;
}

/**
 * Builds the Express app without starting a server, so tests can drive it
 * with Supertest. Security middleware (helmet, CORS, rate limits, auth)
 * arrives in Phase 3 — see PROJECT.md section 17.
 */
export function createApp(config: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter(config));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  return app;
}
