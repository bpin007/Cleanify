/**
 * Who is calling (PROJECT.md sections 14 and 17):
 * - signed-in users: access JWT in the httpOnly `cl_at` cookie;
 * - anonymous visitors: a signed random id in the httpOnly `cl_anon` cookie, created
 *   when they first start a cloud job, so only they can see their jobs;
 * - CSRF: double-submit token. `cl_csrf` (readable by our page) must be echoed in the
 *   `X-CSRF-Token` header on every state-changing request.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../config.js';
import { User, type UserDoc } from '../models.js';
import { verifyAccess } from '../services/auth.js';
import { HttpError, unauthorized } from './errors.js';

export const COOKIES = {
  access: 'cl_at',
  refresh: 'cl_rt',
  anon: 'cl_anon',
  csrf: 'cl_csrf',
  oauth: 'cl_oauth',
} as const;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc | null;
      sessionId?: string | null;
      anonId?: string | null;
    }
  }
}

export function cookieOptions(config: Config, over: CookieOptions = {}): CookieOptions {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/', ...over };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Sets the CSRF cookie if missing; rejects unsafe requests whose header doesn't match. */
export function csrf(
  config: Config,
  skip: (req: Request) => boolean = () => false,
): RequestHandler {
  return (req, res, next) => {
    let token = req.cookies?.[COOKIES.csrf] as string | undefined;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      res.cookie(COOKIES.csrf, token, cookieOptions(config, { httpOnly: false }));
    }
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (safe || skip(req)) return next();
    const header = req.get('x-csrf-token');
    if (!header || !req.cookies?.[COOKIES.csrf] || !safeEqual(header, req.cookies[COOKIES.csrf]))
      return next(
        new HttpError(403, 'csrf', 'Security check failed. Reload the page and try again.'),
      );
    next();
  };
}

/** Loads `req.user` from the access cookie (null when absent or invalid). */
export function readUser(config: Config): RequestHandler {
  return async (req, _res, next) => {
    req.user = null;
    req.sessionId = null;
    const token = req.cookies?.[COOKIES.access] as string | undefined;
    if (token) {
      const claims = await verifyAccess(token, config.secrets.access);
      if (claims) {
        const user = await User.findById(claims.sub).lean<UserDoc>();
        if (user) {
          req.user = user;
          req.sessionId = claims.sid;
        }
      }
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

const signAnon = (id: string, secret: string) =>
  `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`;

export function readAnon(config: Config): RequestHandler {
  return (req, _res, next) => {
    req.anonId = null;
    const raw = req.cookies?.[COOKIES.anon] as string | undefined;
    if (raw) {
      const id = raw.split('.')[0] ?? '';
      if (id && safeEqual(raw, signAnon(id, config.secrets.anon))) req.anonId = id;
    }
    next();
  };
}

/** The anonymous session id, creating it (and its cookie) if needed. */
export function ensureAnon(config: Config, req: Request, res: Response): string {
  if (req.anonId) return req.anonId;
  const id = randomBytes(16).toString('base64url');
  res.cookie(
    COOKIES.anon,
    signAnon(id, config.secrets.anon),
    cookieOptions(config, { maxAge: 24 * 60 * 60 * 1000 }),
  );
  req.anonId = id;
  return id;
}

export type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
