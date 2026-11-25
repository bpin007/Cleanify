import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';
import { AgendaQueue } from './jobs/queue.js';
import { JOBS } from './jobs/work.js';
import { BrevoEmail, ConsoleEmail, DisabledEmail } from './services/email.js';
import { createStorage } from './services/storage/index.js';

// Load the repo-root .env in development (Node 20.12+ built-in, no dotenv needed).
// In production the host (Render) injects environment variables directly.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config = loadConfig();
const db = await connectDatabase(config);
const storage = createStorage(config);
// Development and tests always print emails to this console, even with a key set
// (decision D17). Production sends through Brevo, or refuses if it isn't configured.
const email = !config.isProduction
  ? new ConsoleEmail()
  : config.email
    ? new BrevoEmail(config.email)
    : new DisabledEmail();
const log = (msg: string, e?: unknown) => console.error(msg, e ?? '');
const queue = new AgendaQueue(mongoose.connection, log);

const app = createApp({ config, storage, email, queue, log });
await queue.start();
await queue.every('10 minutes', JOBS.cleanup);

const server = app.listen(config.port, () => {
  console.log(
    `[api] listening on http://localhost:${config.port} (storage: ${storage.kind}, email: ${email.kind}, google: ${config.google ? 'on' : 'off'})`,
  );
});

const shutdown = async () => {
  server.close();
  await queue.stop();
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
