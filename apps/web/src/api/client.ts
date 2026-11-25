/**
 * The website API client (PROJECT.md section 14). Always same-origin /api/* (the Vite
 * proxy in development, the Pages Function in production), so auth cookies are
 * first-party. Sends the CSRF token on every state-changing request, and refreshes
 * the 15-minute access token once when a call comes back 401.
 */
import type {
  ApiError as ApiErrorBody,
  JobInfo,
  MeResponse,
  RuleBody,
  RuleInfo,
  SavedFileInfo,
  UploadTicket,
} from '@cleanify/shared';
import type { AnalyzedData, CleanSettings, Decision, ViewData } from '@cleanify/session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function csrfToken(): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('cl_csrf='))
    ?.slice('cl_csrf='.length);
}

let refreshing: Promise<boolean> | null = null;

/** Exchanges the refresh cookie for new tokens; one at a time for parallel calls. */
function refresh(fetchFn: typeof fetch): Promise<boolean> {
  refreshing ??= (async () => {
    const token = csrfToken();
    const r = await fetchFn('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { 'X-CSRF-Token': decodeURIComponent(token) } : {},
    });
    return r.ok;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(
  path: string,
  opts: RequestOptions = {},
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<T> {
  const method = opts.method ?? 'GET';
  const send = async () => {
    // A GET first gives us the CSRF cookie if this is the very first request.
    if (method !== 'GET' && !csrfToken()) await fetchFn('/api/me', { credentials: 'same-origin' });
    const token = csrfToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && token) headers['X-CSRF-Token'] = decodeURIComponent(token);
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;
    return fetchFn(`/api${path}`, init);
  };
  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/') && (await refresh(fetchFn)))
    res = await send();
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // Not JSON (e.g. the proxy couldn't reach the API).
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? 'http_error',
      body.error?.message ??
        (res.status >= 500
          ? 'The server is not answering. Try again in a minute.'
          : 'Request failed'),
      body.error?.details,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const auth = {
  signup: (b: { email: string; password: string; name?: string }) =>
    api<{ ok: true }>('/auth/signup', { method: 'POST', body: b }),
  login: (b: { email: string; password: string }) =>
    api<{ ok: true }>('/auth/login', { method: 'POST', body: b }),
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
  forgot: (email: string) => api<{ ok: true }>('/auth/forgot', { method: 'POST', body: { email } }),
  reset: (token: string, password: string) =>
    api<{ ok: true }>('/auth/reset', { method: 'POST', body: { token, password } }),
  verify: (token: string) => api<{ ok: true }>('/auth/verify', { method: 'POST', body: { token } }),
  resendVerification: () => api<{ ok: true }>('/auth/verify/resend', { method: 'POST' }),
};

export const me = {
  get: () => api<MeResponse>('/me'),
  update: (b: { name?: string; settings?: { theme?: string; defaultStages?: CleanSettings } }) =>
    api<{ user: MeResponse['user'] }>('/me', { method: 'PATCH', body: b }),
  remove: (confirm: string) => api<{ ok: true }>('/me', { method: 'DELETE', body: { confirm } }),
};

export const jobs = {
  upload: (fileName: string, size: number) =>
    api<UploadTicket>('/uploads', { method: 'POST', body: { fileName, size } }),
  startFile: (jobId: string, settings: CleanSettings) =>
    api<JobInfo>('/jobs', { method: 'POST', body: { jobId, settings } }),
  startText: (text: string, settings: CleanSettings) =>
    api<JobInfo>('/jobs', { method: 'POST', body: { text, settings } }),
  get: (id: string) => api<JobInfo>(`/jobs/${id}`),
  result: (id: string) => api<AnalyzedData>(`/jobs/${id}/result`),
  decide: (id: string, decisions: Decision[]) =>
    api<ViewData>(`/jobs/${id}/decide`, { method: 'POST', body: { decisions } }),
  apply: (id: string, encoding: string, bomCount: number) =>
    api<JobInfo>(`/jobs/${id}/apply`, { method: 'POST', body: { encoding, bomCount } }),
  download: (id: string) => api<{ url: string }>(`/jobs/${id}/download`),
  remove: (id: string) => api<{ ok: true }>(`/jobs/${id}`, { method: 'DELETE' }),
};

export const account = {
  history: (before?: string) =>
    api<{ jobs: JobInfo[]; next: string | null }>(
      `/history${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    ),
  removeHistory: (id: string) => api<{ ok: true }>(`/history/${id}`, { method: 'DELETE' }),
  files: () => api<{ files: SavedFileInfo[] }>('/files'),
  saveFile: (jobId: string) =>
    api<{ file: SavedFileInfo }>('/files', { method: 'POST', body: { jobId } }),
  fileDownload: (id: string) => api<{ url: string }>(`/files/${id}/download`),
  removeFile: (id: string) => api<{ ok: true }>(`/files/${id}`, { method: 'DELETE' }),
  rules: () => api<{ rules: RuleInfo[] }>('/rules'),
  addRule: (b: RuleBody) => api<{ rule: RuleInfo }>('/rules', { method: 'POST', body: b }),
  updateRule: (id: string, b: Partial<RuleBody> & { order?: number }) =>
    api<{ rule: RuleInfo }>(`/rules/${id}`, { method: 'PATCH', body: b }),
  removeRule: (id: string) => api<{ ok: true }>(`/rules/${id}`, { method: 'DELETE' }),
};

/** PUTs a file to a signed upload URL (R2 in production, the API's local storage in dev). */
export async function putFile(
  ticket: UploadTicket,
  file: Blob,
  onProgress: (fraction: number) => void = () => {},
): Promise<void> {
  // XMLHttpRequest, because fetch can't report upload progress.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.upload.method, ticket.upload.url);
    for (const [k, v] of Object.entries(ticket.upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, 'upload_failed', 'The upload failed. Try again.'));
    xhr.onerror = () =>
      reject(new ApiError(0, 'upload_failed', 'The upload failed. Check your connection.'));
    xhr.send(file);
  });
}
