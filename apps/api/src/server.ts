import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_APP_NAME } from '@cleanify/shared';
import { createApp } from './app.js';

// Load the repo-root .env in development (Node 20.12+ built-in, no dotenv needed).
// In production the host (Render) injects environment variables directly.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env['PORT'] ?? 4000);
const app = createApp({
  appName: process.env['APP_NAME'] ?? DEFAULT_APP_NAME,
  version: process.env['npm_package_version'] ?? '0.0.0',
});

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
