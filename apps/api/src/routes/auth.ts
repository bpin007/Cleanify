/**
 * Accounts (PROJECT.md sections 14 and 17): email + password, Google sign-in, password
 * reset and email verification. Errors never reveal whether an email has an account.
 */
import {
  forgotSchema,
  loginSchema,
  resetSchema,
  signupSchema,
  verifySchema,
} from '@cleanify/shared';
import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import { HttpError, parseBody, unauthorized } from '../middleware/errors.js';
import { limiter } from '../middleware/rateLimit.js';
import { COOKIES, cookieOptions, requireUser } from '../middleware/session.js';
import { AuthToken, Session, User, newId, type UserDoc } from '../models.js';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  dummyHash,
  hashPassword,
  randomToken,
  sha256,
  signAccess,
  signRefresh,
  verifyPassword,
  verifyRefresh,
} from '../services/auth.js';
import type { EmailService } from '../services/email.js';
import { googleRoutes, type GoogleClient } from './google.js';

export interface AuthDeps {
  config: Config;
  email: EmailService;
  google: GoogleClient | null;
  log?: (msg: string, e?: unknown) => void;
}

/** Starts a login: a new session (refresh family) and both cookies. */
export async function startSession(config: Config, res: Response, userId: string) {
  const sid = newId();
  const jti = newId();
  await Session.create({
    _id: sid,
    userId,
    jti,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });
  await setAuthCookies(config, res, userId, sid, jti);
  await User.updateOne({ _id: userId }, { lastLoginAt: new Date() });
}

async function setAuthCookies(
  config: Config,
  res: Response,
  sub: string,
  sid: string,
  jti: string,
) {
  res.cookie(
    COOKIES.access,
    await signAccess({ sub, sid }, config.secrets.access),
    cookieOptions(config, { path: '/api', maxAge: ACCESS_TTL_SECONDS * 1000 }),
  );
  res.cookie(
    COOKIES.refresh,
    await signRefresh({ sub, sid, jti }, config.secrets.refresh),
    cookieOptions(config, { path: '/api/auth', maxAge: REFRESH_TTL_SECONDS * 1000 }),
  );
}

export function clearAuthCookies(config: Config, res: Response) {
  res.clearCookie(COOKIES.access, cookieOptions(config, { path: '/api' }));
  res.clearCookie(COOKIES.refresh, cookieOptions(config, { path: '/api/auth' }));
}

async function issueToken(userId: string, purpose: 'reset' | 'verify', ttlMs: number) {
  const token = randomToken();
  await AuthToken.create({
    userId,
    purpose,
    hash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

async function useToken(token: string, purpose: 'reset' | 'verify') {
  const doc = await AuthToken.findOneAndUpdate(
    { hash: sha256(token), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  ).lean();
  if (!doc)
    throw new HttpError(
      400,
      'invalid_token',
      'This link is invalid or has expired. Ask for a new one.',
    );
  return doc.userId;
}

export async function sendVerification(deps: AuthDeps, user: Pick<UserDoc, '_id' | 'email'>) {
  const token = await issueToken(user._id, 'verify', 24 * 60 * 60 * 1000);
  await deps.email.send({
    to: user.email,
    subject: `Confirm your email for ${deps.config.appName}`,
    text: `Confirm your email address by opening this link (valid for 24 hours):\n${deps.config.webOrigin}/verify-email?token=${token}\n`,
  });
}

export function authRoutes(deps: AuthDeps): Router {
  const { config } = deps;
  const log = deps.log ?? ((msg: string, e?: unknown) => console.error(msg, e ?? ''));
  const router = Router();
  const strict = limiter('auth', config.env === 'test' ? 1000 : 10);

  router.post('/signup', strict, async (req, res) => {
    const body = parseBody(signupSchema, req.body);
    const exists = await User.exists({ email: body.email });
    if (exists)
      throw new HttpError(
        409,
        'email_taken',
        'An account with this email already exists. Log in or reset your password.',
      );
    const user = await User.create({
      email: body.email,
      name: body.name ?? '',
      passwordHash: await hashPassword(body.password),
    });
    await startSession(config, res, user._id);
    // The account exists either way; the user can ask for the email again.
    await sendVerification(deps, user).catch((e) => log('[email] verification email failed', e));
    res.status(201).json({ ok: true });
  });

  router.post('/login', strict, async (req, res) => {
    const body = parseBody(loginSchema, req.body);
    const user = await User.findOne({ email: body.email }).lean<UserDoc>();
    const ok = user?.passwordHash
      ? await verifyPassword(user.passwordHash, body.password)
      : (await verifyPassword(await dummyHash(), body.password), false);
    if (!user || !ok) throw new HttpError(401, 'bad_credentials', 'Email or password is wrong');
    await startSession(config, res, user._id);
    res.json({ ok: true });
  });

  router.post('/refresh', async (req: Request, res) => {
    const token = req.cookies?.[COOKIES.refresh] as string | undefined;
    const claims = token ? await verifyRefresh(token, config.secrets.refresh) : null;
    if (!claims) {
      clearAuthCookies(config, res);
      throw unauthorized('Your session has ended. Please log in again.');
    }
    const session = await Session.findById(claims.sid);
    if (!session || session.revokedAt || session.userId !== claims.sub) {
      clearAuthCookies(config, res);
      throw unauthorized('Your session has ended. Please log in again.');
    }
    if (session.jti !== claims.jti) {
      // An old refresh token was used again: someone may have copied it. End the session.
      session.revokedAt = new Date();
      await session.save();
      clearAuthCookies(config, res);
      throw unauthorized('Your session has ended. Please log in again.');
    }
    session.jti = newId();
    session.expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await session.save();
    await setAuthCookies(config, res, claims.sub, claims.sid, session.jti);
    res.json({ ok: true });
  });

  router.post('/logout', async (req, res) => {
    const token = req.cookies?.[COOKIES.refresh] as string | undefined;
    const claims = token ? await verifyRefresh(token, config.secrets.refresh) : null;
    const sid = req.sessionId ?? claims?.sid;
    if (sid) await Session.updateOne({ _id: sid }, { revokedAt: new Date() });
    clearAuthCookies(config, res);
    res.json({ ok: true });
  });

  router.post('/forgot', strict, async (req, res) => {
    const body = parseBody(forgotSchema, req.body);
    const user = await User.findOne({ email: body.email }).lean<UserDoc>();
    if (user) {
      const token = await issueToken(user._id, 'reset', 60 * 60 * 1000);
      // A failure is logged, not returned: an error only for known addresses would
      // reveal which emails have accounts.
      await deps.email
        .send({
          to: user.email,
          subject: `Reset your ${config.appName} password`,
          text: `Someone asked to reset the password for this email. If it was you, open this link (valid for 1 hour):\n${config.webOrigin}/reset-password?token=${token}\n\nIf it wasn't you, ignore this email.\n`,
        })
        .catch((e) => log('[email] password reset email failed', e));
    }
    // Same answer either way: never reveal whether an email has an account.
    res.status(202).json({ ok: true });
  });

  router.post('/reset', strict, async (req, res) => {
    const body = parseBody(resetSchema, req.body);
    const userId = await useToken(body.token, 'reset');
    await User.updateOne(
      { _id: userId },
      { passwordHash: await hashPassword(body.password), emailVerified: true },
    );
    // Log out everywhere: a reset usually means the old password can't be trusted.
    await Session.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
    await startSession(config, res, userId);
    res.json({ ok: true });
  });

  router.post('/verify', async (req, res) => {
    const body = parseBody(verifySchema, req.body);
    const userId = await useToken(body.token, 'verify');
    await User.updateOne({ _id: userId }, { emailVerified: true });
    res.json({ ok: true });
  });

  router.post('/verify/resend', requireUser, strict, async (req, res) => {
    if (!req.user!.emailVerified) await sendVerification(deps, req.user!);
    res.status(202).json({ ok: true });
  });

  router.use('/google', googleRoutes(config, deps.google));
  return router;
}
