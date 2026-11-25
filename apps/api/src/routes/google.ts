/**
 * Google sign-in (authorization code flow with PKCE and state). Off until the owner
 * creates OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET): until then the
 * button sends people back to the login page with a clear message.
 *
 * The network part (code → verified profile) is behind `GoogleClient`, so tests can
 * stand in for Google; the real client verifies the ID token against Google's keys.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import { COOKIES, cookieOptions } from '../middleware/session.js';
import { User } from '../models.js';
import { startSession } from './auth.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface GoogleClient {
  authUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleProfile>;
}

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function realGoogleClient(clientId: string, clientSecret: string): GoogleClient {
  return {
    authUrl({ state, codeChallenge, redirectUri }) {
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return u.toString();
    },
    async exchange({ code, codeVerifier, redirectUri }) {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }),
      });
      if (!r.ok) throw new Error(`Google token exchange failed (${r.status})`);
      const { id_token } = (await r.json()) as { id_token?: string };
      if (!id_token) throw new Error('Google returned no ID token');
      const { payload } = await jwtVerify(id_token, JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: clientId,
      });
      return {
        sub: String(payload.sub),
        email: String(payload['email'] ?? '').toLowerCase(),
        emailVerified: payload['email_verified'] === true,
        name: String(payload['name'] ?? ''),
      };
    },
  };
}

const b64url = (b: Buffer) => b.toString('base64url');

export function googleRoutes(config: Config, google: GoogleClient | null): Router {
  const router = Router();
  const redirectUri = `${config.webOrigin}/api/auth/google/callback`;
  const back = (error: string) => `${config.webOrigin}/login?error=${error}`;

  router.get('/', (req, res) => {
    if (!google) return res.redirect(back('google_unavailable'));
    const state = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    res.cookie(
      COOKIES.oauth,
      JSON.stringify({ state, verifier }),
      cookieOptions(config, { path: '/api/auth/google', maxAge: 10 * 60 * 1000 }),
    );
    res.redirect(google.authUrl({ state, codeChallenge: challenge, redirectUri }));
  });

  router.get('/callback', async (req, res) => {
    if (!google) return res.redirect(back('google_unavailable'));
    const raw = req.cookies?.[COOKIES.oauth] as string | undefined;
    res.clearCookie(COOKIES.oauth, cookieOptions(config, { path: '/api/auth/google' }));
    let saved: { state?: string; verifier?: string } = {};
    try {
      saved = raw ? (JSON.parse(raw) as typeof saved) : {};
    } catch {
      saved = {};
    }
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || !saved.state || state !== saved.state || !saved.verifier)
      return res.redirect(back('google_failed'));

    let profile: GoogleProfile;
    try {
      profile = await google.exchange({ code, codeVerifier: saved.verifier, redirectUri });
    } catch {
      return res.redirect(back('google_failed'));
    }
    if (!profile.email || !profile.emailVerified) return res.redirect(back('google_unverified'));

    let user = await User.findOne({ googleId: profile.sub });
    if (!user) {
      // Link to an existing account with the same (Google-verified) email, or create one.
      user = await User.findOne({ email: profile.email });
      if (user) {
        user.googleId = profile.sub;
        user.emailVerified = true;
        if (!user.name) user.name = profile.name;
        await user.save();
      } else {
        user = await User.create({
          email: profile.email,
          googleId: profile.sub,
          name: profile.name,
          emailVerified: true,
        });
      }
    }
    await startSession(config, res, user._id);
    res.redirect(`${config.webOrigin}/app`);
  });

  return router;
}
