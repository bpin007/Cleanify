/**
 * Cloudflare R2 through the S3 API (AWS SDK v3). Used only when R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set.
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  SIGNED_URL_SECONDS,
  attachment,
  type Bucket,
  type SignedUpload,
  type StorageService,
  type StoredObject,
} from './types.js';

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Record<Bucket, string>;
  /** For tests: a client pointed elsewhere. */
  client?: S3Client;
}

export class R2Storage implements StorageService {
  readonly kind = 'r2' as const;
  private readonly s3: S3Client;
  private readonly names: Record<Bucket, string>;

  constructor(o: R2Options) {
    this.names = o.buckets;
    this.s3 =
      o.client ??
      new S3Client({
        region: 'auto',
        endpoint: `https://${o.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
      });
  }

  async signUpload(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresIn?: number },
  ): Promise<SignedUpload> {
    // The size is checked again (HEAD) before a job starts, since a presigned PUT
    // can't enforce a maximum by itself.
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.names[bucket], Key: key, ContentType: opts.contentType }),
      { expiresIn: opts.expiresIn ?? SIGNED_URL_SECONDS },
    );
    return { url, method: 'PUT', headers: { 'Content-Type': opts.contentType } };
  }

  async signDownload(
    bucket: Bucket,
    key: string,
    opts: { fileName: string; expiresIn?: number },
  ): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.names[bucket],
        Key: key,
        ResponseContentDisposition: attachment(opts.fileName),
      }),
      { expiresIn: opts.expiresIn ?? SIGNED_URL_SECONDS },
    );
  }

  async head(bucket: Bucket, key: string): Promise<StoredObject | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.names[bucket], Key: key }));
      return { key, size: r.ContentLength ?? 0, uploadedAt: r.LastModified ?? new Date(0) };
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.names[bucket], Key: key }));
    return r.Body!.transformToByteArray();
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.names[bucket],
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }) {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.names[to.bucket],
        Key: to.key,
        CopySource: `${this.names[from.bucket]}/${encodeURIComponent(from.key)}`,
      }),
    );
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.names[bucket], Key: key }));
  }

  async list(bucket: Bucket, prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const r = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.names[bucket],
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of r.Contents ?? [])
        if (o.Key)
          out.push({ key: o.Key, size: o.Size ?? 0, uploadedAt: o.LastModified ?? new Date(0) });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deletePrefix(bucket: Bucket, prefix: string): Promise<number> {
    const objects = await this.list(bucket, prefix);
    for (let i = 0; i < objects.length; i += 1000) {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.names[bucket],
          Delete: { Objects: objects.slice(i, i + 1000).map((o) => ({ Key: o.key })), Quiet: true },
        }),
      );
    }
    return objects.length;
  }
}
