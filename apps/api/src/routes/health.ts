import { Router } from 'express';
import type { HealthResponse } from '@cleanify/shared';
import type { AppConfig } from '../app.js';

export function healthRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', name: config.appName, version: config.version };
    res.set('Cache-Control', 'no-store').json(body);
  });

  return router;
}
