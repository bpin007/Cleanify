import { isHealthResponse, type HealthResponse } from '@cleanify/shared';

/** Calls same-origin /api/health (Vite dev proxy locally, Pages Function in production). */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', signal ? { signal } : {});
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const body: unknown = await res.json();
  if (!isHealthResponse(body)) throw new Error('Unexpected health response');
  return body;
}
