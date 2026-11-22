import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { isHealthResponse } from '@cleanify/shared';
import { createApp } from '../src/app';

const app = createApp({ appName: 'Cleanify', version: '0.0.0' });

describe('GET /api/health', () => {
  it('returns ok with name and version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(isHealthResponse(res.body)).toBe(true);
    expect(res.body).toEqual({ status: 'ok', name: 'Cleanify', version: '0.0.0' });
  });

  it('does not advertise Express', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('return a JSON 404 in the standard error shape', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });
});
