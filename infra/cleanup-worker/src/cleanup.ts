/**
 * The deletion rule (PROJECT.md section 14, correction 5): objects under `anon/` older
 * than the anonymous retention (60 min) and under `api/` older than the API retention
 * (24 h) are deleted. Everything else (`users/`) is never touched. R2 listings include
 * each object's upload time, so no database is needed.
 */

/** The part of an R2 bucket binding this Worker uses. */
export interface Bucket {
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
}

export interface Retention {
  anonMinutes: number;
  apiHours: number;
}

export interface CleanupResult {
  scanned: number;
  deleted: number;
}

const BATCH = 1000;

export async function cleanBucket(
  bucket: Bucket,
  retention: Retention,
  now: Date = new Date(),
): Promise<CleanupResult> {
  const rules: [string, number][] = [
    ['anon/', retention.anonMinutes * 60_000],
    ['api/', retention.apiHours * 3_600_000],
  ];
  let scanned = 0;
  let deleted = 0;
  for (const [prefix, maxAge] of rules) {
    // List everything first, then delete: deleting while paging could make the next
    // page skip objects, depending on how the cursor works.
    const expired: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list(
        cursor ? { prefix, cursor, limit: BATCH } : { prefix, limit: BATCH },
      );
      scanned += page.objects.length;
      for (const o of page.objects)
        if (o.key.startsWith(prefix) && now.getTime() - o.uploaded.getTime() > maxAge)
          expired.push(o.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    for (let i = 0; i < expired.length; i += BATCH) {
      await bucket.delete(expired.slice(i, i + BATCH));
    }
    deleted += expired.length;
  }
  return { scanned, deleted };
}

export function retentionFrom(env: {
  ANON_RETENTION_MINUTES?: string;
  API_RETENTION_HOURS?: string;
}): Retention {
  const positive = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    anonMinutes: positive(env.ANON_RETENTION_MINUTES, 60),
    apiHours: positive(env.API_RETENTION_HOURS, 24),
  };
}
