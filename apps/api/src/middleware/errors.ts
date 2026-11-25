/** Errors in the standard shape `{ error: { code, message, details? } }`. */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const unauthorized = (message = 'Please log in') =>
  new HttpError(401, 'unauthorized', message);

/** Parses `req.body` with a schema; a failure becomes a 400 with the field problems. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  throw new HttpError(
    400,
    'invalid_request',
    r.error.issues[0]?.message ?? 'Invalid request',
    r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
};

export function errorHandler(log: (msg: string, err: unknown) => void): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { code: err.code, message: err.message };
      if (err.details !== undefined) body['details'] = err.details;
      res.status(err.status).json({ error: body });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid request' } });
      return;
    }
    // Body parser errors (malformed JSON, too large).
    const status = (err as { status?: number; type?: string }).status;
    if (status === 400 || status === 413) {
      res.status(status).json({
        error: {
          code: status === 413 ? 'too_large' : 'invalid_json',
          message: status === 413 ? 'Request too large' : 'Malformed JSON',
        },
      });
      return;
    }
    // Never log request bodies or file contents (section 17): only the error itself.
    log('[api] unexpected error', err instanceof Error ? (err.stack ?? err.message) : err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
  };
}
