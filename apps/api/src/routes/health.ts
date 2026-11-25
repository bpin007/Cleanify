import { Router } from 'express';
import type { HealthResponse } from '@cleanify/shared';

export function healthRouter(config: { appName: string; version: string }): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', name: config.appName, version: config.version };
    res.set('Cache-Control', 'no-store').json(body);
  });

  return router;
}
