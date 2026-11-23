/**
 * Rate limits (PROJECT.md section 17) with counters in MongoDB, so they survive the API
 * restarting (Render restarts at any time) and count across instances.
 */
import { rateLimit, type Options, type Store } from 'express-rate-limit';
import { RateLimitHit } from '../models.js';

export class MongoStore implements Store {
  private windowMs = 60_000;
  readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string) {
    const id = `${this.prefix}:${key}`;
    const now = Date.now();
    // Start a new window when the old one has ended, otherwise count in it.
    const doc = await RateLimitHit.findOneAndUpdate(
      { _id: id, resetAt: { $gt: new Date(now) } },
      { $inc: { hits: 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (doc) return { totalHits: doc.hits, resetTime: doc.resetAt };
    const resetAt = new Date(now + this.windowMs);
    const fresh = await RateLimitHit.findOneAndUpdate(
      { _id: id },
      { $set: { hits: 1, resetAt } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    return { totalHits: fresh!.hits, resetTime: fresh!.resetAt };
  }

  async decrement(key: string) {
    await RateLimitHit.updateOne({ _id: `${this.prefix}:${key}` }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string) {
    await RateLimitHit.deleteOne({ _id: `${this.prefix}:${key}` });
  }
}

export function limiter(name: string, limit: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: new MongoStore(name),
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many requests. Please wait a minute.' },
      });
    },
  });
}
