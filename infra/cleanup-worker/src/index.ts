/**
 * Cleanup Cron Trigger Worker (correction 5). Runs every 10 minutes on Cloudflare, so
 * anonymous files are deleted on time even while the Render API is asleep.
 * Buckets come from Wrangler bindings (wrangler.toml), not access keys.
 */
import { cleanBucket, retentionFrom } from './cleanup';

export interface Env {
  UPLOADS: R2Bucket;
  OUTPUTS: R2Bucket;
  ANON_RETENTION_MINUTES?: string;
  API_RETENTION_HOURS?: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const retention = retentionFrom(env);
    const now = new Date();
    ctx.waitUntil(
      Promise.all([
        cleanBucket(env.UPLOADS, retention, now),
        cleanBucket(env.OUTPUTS, retention, now),
      ]).then(([u, o]) => {
        // Counts only: object keys contain session ids, so they are not logged.
        console.log(
          `cleanup: deleted ${u.deleted + o.deleted} of ${u.scanned + o.scanned} scanned`,
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
