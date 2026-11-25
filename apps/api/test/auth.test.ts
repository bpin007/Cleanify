import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { Session, User } from '../src/models';
import { linkIn } from '../src/services/email';
import { makeApp, signedIn, useDatabase } from './helpers';

useDatabase();
const t = makeApp();
afterAll(() => t.cleanup());

const cookiesOf = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []);
const cookie = (res: request.Response, name: string) =>
  cookiesOf(res).find((c) => c.startsWith(`${name}=`));

describe('sign up and log in', () => {
  it('signs up, sets httpOnly cookies, and /api/me shows the user', async () => {
    const a = await t.agent();
    const res = await a
      .post('/api/auth/signup')
      .send({ email: ' Ana@Example.com ', password: 'correct horse battery', name: 'Ana' });
    expect(res.status).toBe(201);
    expect(cookie(res, 'cl_at')).toMatch(/HttpOnly/);
    expect(cookie(res, 'cl_at')).toMatch(/SameSite=Lax/);
    expect(cookie(res, 'cl_rt')).toMatch(/Path=\/api\/auth/);
    const me = await a.get('/api/me');
    expect(me.body.user).toMatchObject({
      email: 'ana@example.com',
      name: 'Ana',
      emailVerified: false,
      hasPassword: true,
      google: false,
    });
    const stored = await User.findOne({ email: 'ana@example.com' }).lean();
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    // A verification email was sent.
    expect(linkIn(t.email.last('ana@example.com'))).toMatch(
      /^http:\/\/web\.test\/verify-email\?token=/,
    );
  });

  it('refuses short passwords and bad emails with the field problem', async () => {
    const a = await t.agent();
    const short = await a
      .post('/api/auth/signup')
      .send({ email: 'b@example.com', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toBe('Use at least 10 characters');
    const bad = await a
      .post('/api/auth/signup')
      .send({ email: 'nope', password: 'long enough pass' });
    expect(bad.body.error.code).toBe('invalid_request');
  });

  it('refuses a second account with the same email', async () => {
    await signedIn(t, 'dup@example.com');
    const a = await t.agent();
    const r = await a
      .post('/api/auth/signup')
      .send({ email: 'dup@example.com', password: 'another long one' });
    expect(r.status).toBe(409);
  });

  it('logs in with the right password only, with one message for both failures', async () => {
    await signedIn(t, 'li@example.com', 'the right password');
    const a = await t.agent();
    const wrong = await a
      .post('/api/auth/login')
      .send({ email: 'li@example.com', password: 'nope nope nope' });
    const unknown = await a
      .post('/api/auth/login')
      .send({ email: 'x@example.com', password: 'nope nope nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    const ok = await a
      .post('/api/auth/login')
      .send({ email: 'LI@example.com', password: 'the right password' });
    expect(ok.status).toBe(200);
    expect((await a.get('/api/me')).body.user.email).toBe('li@example.com');
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(t.app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'whatever pass' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });
});

describe('sessions', () => {
  it('rotates the refresh token and ends the session if an old one is reused', async () => {
    const a = await signedIn(t, 'rot@example.com');
    const first = await a.post('/api/auth/refresh');
    expect(first.status).toBe(200);
    const stolen = cookie(first, 'cl_rt')!.split(';')[0]!;
    const second = await a.post('/api/auth/refresh');
    expect(second.status).toBe(200);
    // Replaying the older refresh token revokes the whole session.
    const replay = await request(t.app)
      .post('/api/auth/refresh')
      .set('Cookie', [stolen, `cl_csrf=${a.csrf}`])
      .set('x-csrf-token', a.csrf);
    expect(replay.status).toBe(401);
    const session = await Session.findOne({}).sort({ createdAt: -1 }).lean();
    expect(session!.revokedAt).not.toBeNull();
    expect((await a.post('/api/auth/refresh')).status).toBe(401);
  });

  it('logs out: the session is revoked and cookies cleared', async () => {
    const a = await signedIn(t, 'out@example.com');
    const res = await a.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(cookie(res, 'cl_at')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await a.get('/api/me')).body.user).toBeNull();
    expect((await a.post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('password reset and email verification', () => {
  it('answers the same when the email provider fails, and logs it', async () => {
    await signedIn(t, 'down@example.com', 'old password here');
    const send = t.email.send.bind(t.email);
    t.email.send = async () => {
      throw new Error('provider down');
    };
    try {
      const a = await t.agent();
      const known = await a.post('/api/auth/forgot').send({ email: 'down@example.com' });
      expect(known.status).toBe(202);
      expect(t.logs.some((l) => l.includes('password reset email failed'))).toBe(true);
    } finally {
      t.email.send = send;
    }
  });

  it('sends a reset link only to existing accounts but answers the same', async () => {
    await signedIn(t, 'reset@example.com', 'old password here');
    const a = await t.agent();
    const before = t.email.sent.length;
    const known = await a.post('/api/auth/forgot').send({ email: 'reset@example.com' });
    const unknown = await a.post('/api/auth/forgot').send({ email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(t.email.sent.length).toBe(before + 1);

    const token = new URL(linkIn(t.email.last('reset@example.com'))!).searchParams.get('token')!;
    const reset = await a.post('/api/auth/reset').send({ token, password: 'brand new password' });
    expect(reset.status).toBe(200);
    // The token is single-use, and the old password no longer works.
    expect(
      (await a.post('/api/auth/reset').send({ token, password: 'another new one!' })).status,
    ).toBe(400);
    const b = await t.agent();
    expect(
      (
        await b
          .post('/api/auth/login')
          .send({ email: 'reset@example.com', password: 'old password here' })
      ).status,
    ).toBe(401);
    expect(
      (
        await b
          .post('/api/auth/login')
          .send({ email: 'reset@example.com', password: 'brand new password' })
      ).status,
    ).toBe(200);
  });

  it('verifies the email address with the emailed token', async () => {
    const a = await signedIn(t, 'verify@example.com');
    const token = new URL(linkIn(t.email.last('verify@example.com'))!).searchParams.get('token')!;
    expect((await a.post('/api/auth/verify').send({ token })).status).toBe(200);
    expect((await a.get('/api/me')).body.user.emailVerified).toBe(true);
    expect((await a.post('/api/auth/verify').send({ token })).status).toBe(400);
  });
});

describe('Google sign-in', () => {
  it('sends people back to the login page while it is not configured', async () => {
    const res = await request(t.app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('http://web.test/login?error=google_unavailable');
    expect((await (await t.agent()).get('/api/me')).body.google).toEqual({ enabled: false });
  });

  const fake = (profile: {
    sub: string;
    email: string;
    emailVerified?: boolean;
    name?: string;
  }) => {
    const calls: { code: string; codeVerifier: string; redirectUri: string }[] = [];
    return {
      calls,
      client: {
        authUrl: ({ state, codeChallenge }: { state: string; codeChallenge: string }) =>
          `https://accounts.example/auth?state=${state}&cc=${codeChallenge}`,
        exchange: async (p: { code: string; codeVerifier: string; redirectUri: string }) => {
          calls.push(p);
          return { emailVerified: true, name: '', ...profile };
        },
      },
    };
  };

  async function signInWith(app: ReturnType<typeof makeApp>) {
    const a = request.agent(app.app);
    const start = await a.get('/api/auth/google');
    const state = new URL(start.headers['location']!).searchParams.get('state')!;
    return {
      a,
      state,
      callback: (s: string) => a.get(`/api/auth/google/callback?code=abc&state=${s}`),
    };
  }

  it('signs in a new user with a verified Google email, using PKCE and state', async () => {
    const g = fake({ sub: 'g-1', email: 'gina@example.com', name: 'Gina' });
    const app = makeApp({}, { google: g.client });
    const { a, state, callback } = await signInWith(app);
    const res = await callback(state);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('http://web.test/app');
    expect(g.calls[0]).toMatchObject({
      code: 'abc',
      redirectUri: 'http://web.test/api/auth/google/callback',
    });
    expect(g.calls[0]!.codeVerifier.length).toBeGreaterThan(40);
    const me = await a.get('/api/me');
    expect(me.body.user).toMatchObject({
      email: 'gina@example.com',
      google: true,
      emailVerified: true,
      hasPassword: false,
    });
    app.cleanup();
  });

  it('links Google to an existing account with the same email', async () => {
    await signedIn(t, 'link@example.com');
    const g = fake({ sub: 'g-2', email: 'link@example.com' });
    const app = makeApp({}, { google: g.client });
    const { state, callback } = await signInWith(app);
    await callback(state);
    const user = await User.findOne({ email: 'link@example.com' }).lean();
    expect(user!.googleId).toBe('g-2');
    expect(await User.countDocuments({ email: 'link@example.com' })).toBe(1);
    app.cleanup();
  });

  it('refuses a wrong state and unverified Google emails', async () => {
    const g = fake({ sub: 'g-3', email: 'u@example.com', emailVerified: false });
    const app = makeApp({}, { google: g.client });
    const first = await signInWith(app);
    expect((await first.callback('forged')).headers['location']).toMatch(/error=google_failed/);
    const second = await signInWith(app);
    expect((await second.callback(second.state)).headers['location']).toMatch(
      /error=google_unverified/,
    );
    app.cleanup();
  });
});
