/**
 * @cleanify/shared — constants and types shared by apps/web and apps/api.
 */

/** Default product name. Overridable via VITE_APP_NAME (web) / APP_NAME (api). */
export const DEFAULT_APP_NAME = 'Cleanify';

/** Response body of GET /api/health. */
export interface HealthResponse {
  status: 'ok';
  name: string;
  version: string;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['status'] === 'ok' && typeof v['name'] === 'string' && typeof v['version'] === 'string';
}

export * from './api';
