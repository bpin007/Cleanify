/**
 * MongoDB collections (PROJECT.md section 14), as Mongoose models.
 * Ids are strings (random, URL-safe) so they can go in storage keys and URLs as is.
 */
import { randomBytes } from 'node:crypto';
import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const newId = () => randomBytes(12).toString('base64url');

const id = { type: String, default: newId };

const userSchema = new Schema(
  {
    _id: id,
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    // No default: a unique index must not see every password-only user as googleId null.
    googleId: { type: String },
    name: { type: String, default: '' },
    emailVerified: { type: Boolean, default: false },
    settings: {
      theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
      defaultStages: { type: Schema.Types.Mixed, default: null },
    },
    storageUsedBytes: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
);

/** One login (refresh-token family). Rotating the refresh token changes `jti`. */
const sessionSchema = new Schema(
  {
    _id: id,
    userId: { type: String, required: true, index: true },
    jti: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

/** Single-use email tokens (password reset, email verification). Only a hash is stored. */
const authTokenSchema = new Schema(
  {
    _id: id,
    userId: { type: String, required: true, index: true },
    purpose: { type: String, enum: ['reset', 'verify'], required: true },
    hash: { type: String, required: true, unique: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

const jobSchema = new Schema(
  {
    _id: id,
    ownerId: { type: String, default: null, index: true },
    anonSessionId: { type: String, default: null, index: true },
    apiKeyId: { type: String, default: null },
    status: {
      type: String,
      enum: ['uploading', 'queued', 'running', 'done', 'failed', 'expired'],
      default: 'uploading',
    },
    /** Storage prefix: anon/{sid}/{jobId}, users/{uid}/{jobId} or api/{keyId}/{jobId}. */
    prefix: { type: String, required: true },
    input: {
      kind: { type: String, enum: ['text', 'file'], required: true },
      fileName: { type: String, default: null },
      size: { type: Number, default: 0 },
      format: { type: String, enum: ['text', 'csv', 'sheet'], default: 'text' },
    },
    settings: { type: Schema.Types.Mixed, default: null },
    decisions: { type: [Schema.Types.Mixed], default: [] },
    progress: {
      phase: { type: String, default: '' },
      fraction: { type: Number, default: 0 },
    },
    summary: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    output: {
      status: {
        type: String,
        enum: ['none', 'queued', 'running', 'done', 'blocked', 'failed'],
        default: 'none',
      },
      encoding: { type: String, default: null },
      bomCount: { type: Number, default: 0 },
      fileName: { type: String, default: null },
      size: { type: Number, default: 0 },
      /** Bumped on every apply, so a stale build never overwrites a newer one. */
      version: { type: Number, default: 0 },
      blockedChars: { type: [Schema.Types.Mixed], default: undefined },
    },
    /** TTL index: anonymous jobs (1 h) and API-key jobs (24 h) are removed by MongoDB. */
    expiresAt: { type: Date, default: null, index: { expires: 0 } },
  },
  { timestamps: true },
);

const savedFileSchema = new Schema(
  {
    _id: id,
    ownerId: { type: String, required: true, index: true },
    jobId: { type: String, required: true },
    name: { type: String, required: true },
    key: { type: String, required: true },
    size: { type: Number, required: true },
    format: { type: String, required: true },
  },
  { timestamps: true },
);

const ruleSchema = new Schema(
  {
    _id: id,
    ownerId: { type: String, required: true, index: true },
    /** 'replace': from → to. 'keep': `from` is text the ASCII step leaves alone. */
    kind: { type: String, enum: ['replace', 'keep'], default: 'replace' },
    name: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, default: '' },
    isRegex: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/** Daily counters per subject (user, anonymous session or API key), kept 90 days. */
const usageSchema = new Schema({
  subject: { type: String, required: true },
  day: { type: String, required: true },
  jobs: { type: Number, default: 0 },
  translateChars: { type: Number, default: 0 },
  apiCalls: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 90 } },
});
usageSchema.index({ subject: 1, day: 1 }, { unique: true });

/** Rate-limit counters (express-rate-limit store), removed when the window ends. */
const rateLimitSchema = new Schema({
  _id: String,
  hits: { type: Number, default: 0 },
  resetAt: { type: Date, required: true, index: { expires: 0 } },
});

export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const AuthToken = mongoose.model('AuthToken', authTokenSchema);
export const Job = mongoose.model('Job', jobSchema);
export const SavedFile = mongoose.model('SavedFile', savedFileSchema);
export const Rule = mongoose.model('Rule', ruleSchema);
export const Usage = mongoose.model('Usage', usageSchema);
export const RateLimitHit = mongoose.model('RateLimitHit', rateLimitSchema);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: string };
/** A job as read with .lean() (written out: Mongoose infers nested objects as optional). */
export interface JobDoc {
  _id: string;
  ownerId: string | null;
  anonSessionId: string | null;
  apiKeyId: string | null;
  status: 'uploading' | 'queued' | 'running' | 'done' | 'failed' | 'expired';
  prefix: string;
  input: {
    kind: 'text' | 'file';
    fileName: string | null;
    size: number;
    format: 'text' | 'csv' | 'sheet';
  };
  settings: unknown;
  decisions: unknown[];
  progress: { phase: string; fraction: number };
  summary: unknown;
  error: string | null;
  output: {
    status: 'none' | 'queued' | 'running' | 'done' | 'blocked' | 'failed';
    encoding: string | null;
    bomCount: number;
    fileName: string | null;
    size: number;
    version: number;
    blockedChars?: unknown[];
  };
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
