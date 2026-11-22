# R2 cleanup Worker (correction 5)

Phase 3. A Cloudflare Cron Trigger Worker that runs every 10 minutes and deletes R2 objects under
`anon/` older than 1 hour and under `api/` older than 24 hours, using the upload time in R2
listings (no database access). It reaches the bucket through a Wrangler binding, not access keys.

Nothing here yet.
