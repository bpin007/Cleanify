/**
 * Local-disk storage for development and tests. Signed URLs point at the API itself
 * (`/api/storage/local/:token`), with an HMAC-signed token that carries the bucket,
 * key, method, expiry and size limit, so the browser flow is the same as with R2.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type Request } from 'express';
import { HttpError } from '../../middleware/errors.js';
import {
  SIGNED_URL_SECONDS,
  attachment,
  type Bucket,
  type SignedUpload,
  type StorageService,
  type StoredObject,
} from './types.js';

interface Ticket {
  b: Bucket;
  k: string;
  m: 'PUT' | 'GET';
  exp: number;
  max?: number;
  ct?: string;
  fn?: string;
}

const BUCKETS: Bucket[] = ['uploads', 'outputs'];

export class LocalStorage implements StorageService {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly secret: string,
    /** Absolute URL prefix the browser uses for the API, e.g. http://localhost:5173/api. */
    private readonly publicApiBase: string,
    private readonly now: () => number = Date.now,
  ) {
    this.root = resolve(root);
  }

  /** Maps a key to a path inside the bucket folder; keys can never escape it. */
  private path(bucket: Bucket, key: string): string {
    if (!BUCKETS.includes(bucket)) throw new Error(`Unknown bucket ${bucket}`);
    const base = join(this.root, bucket);
    const p = resolve(base, ...key.split('/'));
    if (p !== base && !p.startsWith(base + sep)) throw new Error(`Invalid key ${key}`);
    return p;
  }

  sign(t: Ticket): string {
    const body = Buffer.from(JSON.stringify(t)).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  verify(token: string, method: 'PUT' | 'GET'): Ticket {
    const [body, mac] = token.split('.');
    if (!body || !mac) throw new HttpError(403, 'bad_signature', 'Invalid link');
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new HttpError(403, 'bad_signature', 'Invalid link');
    const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as Ticket;
    if (t.m !== method) throw new HttpError(403, 'bad_signature', 'Invalid link');
    if (t.exp < this.now()) throw new HttpError(403, 'link_expired', 'This link has expired');
    return t;
  }

  async signUpload(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresIn?: number },
  ): Promise<SignedUpload> {
    const exp = this.now() + (opts.expiresIn ?? SIGNED_URL_SECONDS) * 1000;
    const token = this.sign({
      b: bucket,
      k: key,
      m: 'PUT',
      exp,
      max: opts.maxBytes,
      ct: opts.contentType,
    });
    return {
      url: `${this.publicApiBase}/storage/local/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': opts.contentType },
    };
  }

  async signDownload(
    bucket: Bucket,
    key: string,
    opts: { fileName: string; expiresIn?: number },
  ): Promise<string> {
    const exp = this.now() + (opts.expiresIn ?? SIGNED_URL_SECONDS) * 1000;
    return `${this.publicApiBase}/storage/local/${this.sign({ b: bucket, k: key, m: 'GET', exp, fn: opts.fileName })}`;
  }

  async head(bucket: Bucket, key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.path(bucket, key));
      return s.isFile() ? { key, size: s.size, uploadedAt: s.mtime } : null;
    } catch {
      return null;
    }
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(bucket, key)));
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, _contentType?: string): Promise<void> {
    const p = this.path(bucket, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }) {
    const target = this.path(to.bucket, to.key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(this.path(from.bucket, from.key), target);
  }

  async delete(bucket: Bucket, key: string): Promise<void> {
    await rm(this.path(bucket, key), { force: true });
  }

  async list(bucket: Bucket, prefix: string): Promise<StoredObject[]> {
    const base = join(this.root, bucket);
    const out: StoredObject[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          const key = relative(base, p).split(sep).join('/');
          if (!key.startsWith(prefix)) continue;
          const s = await stat(p);
          out.push({ key, size: s.size, uploadedAt: s.mtime });
        }
      }
    };
    await walk(base);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  async deletePrefix(bucket: Bucket, prefix: string): Promise<number> {
    const objects = await this.list(bucket, prefix);
    await Promise.all(objects.map((o) => this.delete(bucket, o.key)));
    return objects.length;
  }

  /** The routes that serve signed local URLs. Mounted at /api/storage/local. */
  router(): Router {
    const router = Router();
    router.put('/:token', async (req: Request<{ token: string }>, res) => {
      const t = this.verify(req.params.token, 'PUT');
      const declared = Number(req.headers['content-length'] ?? 0);
      if (t.max !== undefined && declared > t.max)
        throw new HttpError(413, 'too_large', 'The file is larger than allowed');
      const p = this.path(t.b, t.k);
      await mkdir(dirname(p), { recursive: true });
      let seen = 0;
      const limit = t.max;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          seen += chunk.length;
          if (limit !== undefined && seen > limit)
            cb(new HttpError(413, 'too_large', 'The file is larger than allowed'));
          else cb(null, chunk);
        },
      });
      try {
        await pipeline(req, counter, createWriteStream(p));
      } catch (e) {
        await rm(p, { force: true });
        throw e;
      }
      res.status(200).end();
    });
    router.get('/:token', async (req: Request<{ token: string }>, res) => {
      const t = this.verify(req.params.token, 'GET');
      const p = this.path(t.b, t.k);
      const s = await stat(p).catch(() => null);
      if (!s) throw new HttpError(404, 'not_found', 'File not found');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(s.size));
      if (t.fn) res.setHeader('Content-Disposition', attachment(t.fn));
      await pipeline(Readable.from(await readFile(p)), res);
    });
    return router;
  }
}
