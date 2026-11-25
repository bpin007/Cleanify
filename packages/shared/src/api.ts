/**
 * Request schemas and response types for the website API (PROJECT.md section 14).
 * The API validates every request body with these; the web app uses the same ones
 * for its forms, so both sides agree on the rules.
 */
import { z } from 'zod';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const forgotSchema = z.object({ email: emailSchema });
export const resetSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordSchema,
});
export const verifySchema = z.object({ token: z.string().min(16).max(200) });

export const settingsSchema = z.object({
  repair: z.boolean(),
  ascii: z.boolean(),
  asciiScope: z.enum(['all', 'invisible']),
  asciiOptions: z.object({
    emoji: z.enum(['keep', 'remove', 'text']).optional(),
    nonLatin: z.enum(['keep', 'transliterate']).optional(),
    guillemets: z.enum(['angle', 'quote']).optional(),
  }),
});

/**
 * Custom rules as the engine takes them (PROJECT.md section 5). Anonymous users send
 * their session-only rules with a cloud job; signed-in users' saved rules are loaded
 * on the server instead.
 */
export const MAX_RULES = 200;
const ruleText = z.string().min(1).max(500);
export const ruleSetSchema = z.object({
  replace: z
    .array(z.object({ name: z.string().max(100), from: ruleText, to: z.string().max(500) }))
    .max(MAX_RULES)
    .optional(),
  keep: z
    .array(z.object({ name: z.string().max(100), text: ruleText }))
    .max(MAX_RULES)
    .optional(),
});
export type RuleSetBody = z.infer<typeof ruleSetSchema>;

/** Settings for one cleaning run: the default steps plus the rules to apply. */
export const jobSettingsSchema = settingsSchema.extend({ rules: ruleSetSchema.optional() });

export const updateMeSchema = z.object({
  name: z.string().trim().max(100).optional(),
  settings: z
    .object({
      theme: z.enum(['system', 'light', 'dark']).optional(),
      defaultStages: settingsSchema.optional(),
    })
    .optional(),
});

export const deleteMeSchema = z.object({
  /** The account's email, typed again to confirm. */
  confirm: emailSchema,
});

export const INPUT_FORMATS = ['text', 'csv', 'sheet'] as const;

export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
});

export const createJobSchema = z.union([
  z.object({ jobId: z.string().min(1).max(64), settings: jobSettingsSchema }),
  z.object({ text: z.string().min(1), settings: jobSettingsSchema }),
]);

export const decisionSchema = z.union([
  z.object({ type: z.literal('one'), id: z.string().min(1).max(64), accepted: z.boolean() }),
  z.object({
    type: z.literal('group'),
    stage: z.enum(['encoding', 'ascii', 'invisible', 'translate', 'rule', 'safety']),
    kind: z.string().max(64).optional(),
    accepted: z.boolean(),
  }),
]);

export const decideSchema = z.object({ decisions: z.array(decisionSchema).min(1).max(1000) });

export const ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'utf-32le',
  'utf-32be',
  'windows-1252',
  'shift_jis',
] as const;

export const applySchema = z.object({
  encoding: z.enum(ENCODINGS),
  bomCount: z.number().int().min(0).max(1),
});

export const saveFileSchema = z.object({ jobId: z.string().min(1).max(64) });

/**
 * A saved rule. 'replace': `from` → `to`, plain text, exact (no patterns in v1).
 * 'keep': `from` is text the ASCII step must leave alone (e.g. "é"); `to` is unused.
 */
export const RULE_KINDS = ['replace', 'keep'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
const ruleFields = {
  kind: z.enum(RULE_KINDS),
  name: z.string().trim().min(1).max(100),
  from: z.string().min(1).max(500),
  to: z.string().max(500),
  enabled: z.boolean(),
};
export const ruleSchema = z.object({
  ...ruleFields,
  kind: ruleFields.kind.default('replace'),
  to: ruleFields.to.default(''),
  enabled: ruleFields.enabled.default(true),
});
// Built from the fields without defaults: zod applies defaults even inside .partial(),
// which would reset fields the PATCH didn't mention (e.g. re-enable a rule on reorder).
export const updateRuleSchema = z
  .object(ruleFields)
  .partial()
  .extend({ order: z.number().int().min(0).optional() });

export type SignupBody = z.infer<typeof signupSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type CreateJobBody = z.infer<typeof createJobSchema>;
export type RuleBody = z.infer<typeof ruleSchema>;

/** The standard error body: `{ error: { code, message, details? } }`. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface MeUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  google: boolean;
  settings: {
    theme: 'system' | 'light' | 'dark';
    defaultStages: z.infer<typeof settingsSchema> | null;
  };
  storageUsedBytes: number;
  createdAt: string;
}

export interface Quotas {
  cloudFileBytes: number;
  cloudJobsPerDay: number;
  cloudJobsToday: number;
  storageBytes: number | null;
  retentionMinutes: number | null;
}

export interface MeResponse {
  user: MeUser | null;
  quotas: Quotas;
  google: { enabled: boolean };
}

export type JobStatus = 'uploading' | 'queued' | 'running' | 'done' | 'failed' | 'expired';
export type OutputStatus = 'none' | 'queued' | 'running' | 'done' | 'blocked' | 'failed';

export interface JobInfo {
  id: string;
  status: JobStatus;
  progress: { phase: string; fraction: number };
  input: { kind: 'text' | 'file'; fileName: string | null; size: number; format: string };
  summary: Record<string, number> | null;
  error: string | null;
  output: {
    status: OutputStatus;
    encoding: string | null;
    fileName: string | null;
    blockedChars?: { char: string; line: number; column: number }[];
  };
  saved: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface UploadTicket {
  jobId: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}

export interface SavedFileInfo {
  id: string;
  jobId: string;
  name: string;
  size: number;
  format: string;
  createdAt: string;
}

export interface RuleInfo {
  id: string;
  kind: RuleKind;
  name: string;
  from: string;
  to: string;
  enabled: boolean;
  order: number;
  createdAt: string;
}

/** Enabled rules, in order, as the engine's rule set. */
export function toRuleSet(
  rules: readonly { kind: RuleKind; name: string; from: string; to: string; enabled: boolean }[],
): {
  replace: { name: string; from: string; to: string }[];
  keep: { name: string; text: string }[];
} {
  const on = rules.filter((r) => r.enabled);
  return {
    replace: on
      .filter((r) => r.kind === 'replace')
      .map((r) => ({ name: r.name, from: r.from, to: r.to })),
    keep: on.filter((r) => r.kind === 'keep').map((r) => ({ name: r.name, text: r.from })),
  };
}

/** Accepted files (PROJECT.md section 7), shared by the web app and the API. */
export const TEXT_EXTENSIONS = ['txt', 'log', 'md', 'json', 'xml', 'sql'];
export const CSV_EXTENSIONS = ['csv', 'tsv'];
export const SHEET_EXTENSIONS = ['xlsx', 'xls', 'ods', 'accdb', 'mdb'];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function formatOfFileName(name: string): (typeof INPUT_FORMATS)[number] | null {
  const ext = extensionOf(name);
  if (CSV_EXTENSIONS.includes(ext)) return 'csv';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (SHEET_EXTENSIONS.includes(ext)) return 'sheet';
  return null;
}
