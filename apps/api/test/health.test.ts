import { afterAll, describe, expect, it } from 'vitest';
import { isHealthResponse } from '@cleanify/shared';
import { makeApp, useDatabase } from './helpers';

useDatabase();
const t = makeApp({ appName: 'Cleanify', version: '0.0.0' });
afterAll(() => t.cleanup());

describe('GET /api/health', () => {
  it('returns ok with name and version', async () => {
    const res = await (await t.agent()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(isHealthResponse(res.body)).toBe(true);
    expect(res.body).toEqual({ status: 'ok', name: 'Cleanify', version: '0.0.0' });
  });

  it('sends security headers and does not advertise Express', async () => {
    const res = await (await t.agent()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('unknown routes', () => {
  it('return a JSON 404 in the standard error shape', async () => {
    const res = await (await t.agent()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });
});
