/**
 * File storage (PROJECT.md section 14). Two adapters behind one interface:
 * - local disk, for development and tests (no account needed);
 * - Cloudflare R2 through the S3 API, used only when the R2_* variables are set.
 *
 * Browsers upload and download directly with short-lived signed URLs (10 minutes),
 * so file contents never pass through API memory on the way in or out.
 */
export type Bucket = 'uploads' | 'outputs';

export interface StoredObject {
  key: string;
  size: number;
  uploadedAt: Date;
}

export interface SignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageService {
  readonly kind: 'local' | 'r2';
  /** A URL the browser can PUT the file to, valid for `expiresIn` seconds. */
  signUpload(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresIn?: number },
  ): Promise<SignedUpload>;
  /** A URL the browser can GET the file from, downloaded as `fileName`. */
  signDownload(
    bucket: Bucket,
    key: string,
    opts: { fileName: string; expiresIn?: number },
  ): Promise<string>;
  head(bucket: Bucket, key: string): Promise<StoredObject | null>;
  get(bucket: Bucket, key: string): Promise<Uint8Array>;
  put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void>;
  copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }): Promise<void>;
  delete(bucket: Bucket, key: string): Promise<void>;
  /** Deletes every object whose key starts with `prefix`; returns how many. */
  deletePrefix(bucket: Bucket, prefix: string): Promise<number>;
  list(bucket: Bucket, prefix: string): Promise<StoredObject[]>;
}

export const SIGNED_URL_SECONDS = 600;

/** `Content-Disposition` for a download, safe for any file name. */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
