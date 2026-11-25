/**
 * Passwords and tokens (PROJECT.md section 17): argon2id hashes; a short-lived access
 * JWT (15 min) and a rotating refresh JWT (7 days), both in httpOnly cookies; random
 * single-use email tokens stored only as SHA-256 hashes.
 */
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password).catch(() => false);

/** A real hash to compare against when the email is unknown, so timing doesn't tell. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const key = (secret: string) => new TextEncoder().encode(secret);

export interface AccessClaims {
  sub: string;
  sid: string;
}
export interface RefreshClaims extends AccessClaims {
  jti: string;
}

export async function signAccess(c: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ sid: c.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .setAudience('access')
    .sign(key(secret));
}

export async function signRefresh(c: RefreshClaims, secret: string): Promise<string> {
  return new SignJWT({ sid: c.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setJti(c.jti)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
    .setAudience('refresh')
    .sign(key(secret));
}

export async function verifyAccess(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      audience: 'access',
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') return null;
    return { sub: payload.sub, sid: payload['sid'] };
  } catch {
    return null;
  }
}

export async function verifyRefresh(token: string, secret: string): Promise<RefreshClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      audience: 'refresh',
      algorithms: ['HS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload['sid'] !== 'string' ||
      typeof payload.jti !== 'string'
    )
      return null;
    return { sub: payload.sub, sid: payload['sid'], jti: payload.jti };
  } catch {
    return null;
  }
}
