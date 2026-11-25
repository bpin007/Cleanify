/**
 * Cloud-mode end-to-end tests: the built site plus a real API. The API runs with
 * NODE_ENV=test, so it gets a throwaway in-memory MongoDB (mongodb-memory-server) and
 * local-disk storage instead of R2. Separate from playwright.config.ts so the
 * browser-only suite stays fast and needs no API.
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 4174;
const API_PORT = 4100;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const CI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e-cloud',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list']] : 'list',
  timeout: 90_000,
  use: { baseURL: WEB_ORIGIN, trace: 'retain-on-failure', acceptDownloads: true },
  projects: [{ name: 'cloud', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @cleanify/api exec tsx src/server.ts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        WEB_ORIGIN,
        LOCAL_STORAGE_DIR: '.data/e2e-storage',
      },
      reuseExistingServer: !CI,
      // The first run downloads the mongod binary for mongodb-memory-server.
      timeout: 180_000,
      stdout: 'pipe',
    },
    {
      // The production build, with `vite preview` forwarding /api to the API above, as
      // the Pages Function does in production.
      command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
});
