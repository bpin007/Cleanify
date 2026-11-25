/**
 * API configuration from environment variables (PROJECT.md section 21). Limits and
 * retention are config, not code (section 18).
 *
 * Secrets are never invented in production: missing ones stop the server. In
 * development and tests, missing secrets get random values for this run only (sessions
 * then end on restart), so the API runs with an empty .env.
 */
import { randomBytes } from 'node:crypto';
import { DEFAULT_APP_NAME } from '@cleanify/shared';
import { z } from 'zod';

const num = (fallback: number) => z.coerce.number().positive().default(fallback);
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_NAME: z.string().default(DEFAULT_APP_NAME),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: optional,
  JWT_ACCESS_SECRET: optional,
  JWT_REFRESH_SECRET: optional,
  ANON_SESSION_SECRET: optional,
  /** Signs local-disk storage URLs (dev/tests only). */
  STORAGE_SIGNING_SECRET: optional,
  /** Number of proxies in front of the API (Pages Function + Render = 2 in production). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET_UPLOADS: z.string().default('cleanify-uploads'),
  R2_BUCKET_OUTPUTS: z.string().default('cleanify-outputs'),
  /** Local-disk storage folder, used when R2 is not configured. */
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),

  ANON_RETENTION_MINUTES: num(60),
  API_RETENTION_HOURS: num(24),

  /** Brevo API key (decision D17). */
  EMAIL_API_KEY: optional,
  /** Sender address, verified in Brevo. */
  EMAIL_FROM: optional,
  /** Sender name shown to recipients. Default: APP_NAME. */
  EMAIL_FROM_NAME: optional,

  // Limits (section 18)
  ANON_CLOUD_FILE_MB: num(10),
  USER_CLOUD_FILE_MB: num(50),
  ANON_CLOUD_JOBS_PER_DAY: num(10),
  USER_CLOUD_JOBS_PER_DAY: num(100),
  USER_STORAGE_MB: num(200),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  appName: string;
  version: string;
  webOrigin: string;
  mongoUri: string | undefined;
  trustProxy: number;
  secrets: { access: string; refresh: string; anon: string; storage: string };
  google: { clientId: string; clientSecret: string } | null;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string } | null;
  buckets: { uploads: string; outputs: string };
  localStorageDir: string;
  retention: { anonMinutes: number; apiHours: number };
  email: { apiKey: string; from: string; fromName: string } | null;
  limits: {
    anonFileBytes: number;
    userFileBytes: number;
    anonJobsPerDay: number;
    userJobsPerDay: number;
    userStorageBytes: number;
  };
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, warn = console.warn): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  const secret = (name: keyof typeof e, value: string | undefined): string => {
    if (value) {
      if (isProduction && value.length < 32)
        throw new ConfigError(`${name} must be at least 32 characters`);
      return value;
    }
    if (isProduction) throw new ConfigError(`${name} is required in production`);
    if (e.NODE_ENV === 'development')
      warn(`[config] ${name} is not set: using a random value for this run only.`);
    return randomBytes(32).toString('base64url');
  };

  if (isProduction && !e.MONGODB_URI)
    throw new ConfigError('MONGODB_URI is required in production');

  const r2Parts = [e.R2_ACCOUNT_ID, e.R2_ACCESS_KEY_ID, e.R2_SECRET_ACCESS_KEY];
  if (r2Parts.some(Boolean) && !r2Parts.every(Boolean))
    throw new ConfigError(
      'Set all of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, or none',
    );
  if (isProduction && !r2Parts.every(Boolean))
    throw new ConfigError(
      'R2 must be configured in production (local-disk storage is for development)',
    );

  const googleParts = [e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET];
  if (googleParts.some(Boolean) && !googleParts.every(Boolean))
    throw new ConfigError('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither');

  const MB = 1024 * 1024;
  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    appName: e.APP_NAME,
    version: env['npm_package_version'] ?? '0.0.0',
    webOrigin: e.WEB_ORIGIN.replace(/\/$/, ''),
    mongoUri: e.MONGODB_URI,
    trustProxy: e.TRUST_PROXY,
    secrets: {
      access: secret('JWT_ACCESS_SECRET', e.JWT_ACCESS_SECRET),
      refresh: secret('JWT_REFRESH_SECRET', e.JWT_REFRESH_SECRET),
      anon: secret('ANON_SESSION_SECRET', e.ANON_SESSION_SECRET),
      storage: e.STORAGE_SIGNING_SECRET ?? randomBytes(32).toString('base64url'),
    },
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : null,
    r2:
      e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY
        ? {
            accountId: e.R2_ACCOUNT_ID,
            accessKeyId: e.R2_ACCESS_KEY_ID,
            secretAccessKey: e.R2_SECRET_ACCESS_KEY,
          }
        : null,
    buckets: { uploads: e.R2_BUCKET_UPLOADS, outputs: e.R2_BUCKET_OUTPUTS },
    localStorageDir: e.LOCAL_STORAGE_DIR,
    retention: { anonMinutes: e.ANON_RETENTION_MINUTES, apiHours: e.API_RETENTION_HOURS },
    email:
      e.EMAIL_API_KEY && e.EMAIL_FROM
        ? { apiKey: e.EMAIL_API_KEY, from: e.EMAIL_FROM, fromName: e.EMAIL_FROM_NAME ?? e.APP_NAME }
        : null,
    limits: {
      anonFileBytes: e.ANON_CLOUD_FILE_MB * MB,
      userFileBytes: e.USER_CLOUD_FILE_MB * MB,
      anonJobsPerDay: e.ANON_CLOUD_JOBS_PER_DAY,
      userJobsPerDay: e.USER_CLOUD_JOBS_PER_DAY,
      userStorageBytes: e.USER_STORAGE_MB * MB,
    },
  };
}

/** Config for tests: development-like defaults, overridable. */
export function testConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig({ NODE_ENV: 'test' }), ...over };
}
