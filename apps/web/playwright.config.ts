/**
 * End-to-end tests (PROJECT.md section 20): the built site in a real browser, on a
 * desktop and a phone-sized screen, with axe accessibility checks.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = Boolean(process.env['CI']);
// Firefox and WebKit run nightly and on pull requests into main (owner decision,
// Phase 2 review); every push runs Chromium only.
const ALL_BROWSERS = Boolean(process.env['E2E_ALL_BROWSERS']);
// Layout and axe results don't depend on the browser engine: Chromium covers them.
const OTHER_ENGINES_SKIP = /(phone|a11y)\.spec/;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec/ },
    // Phone width: layout and accessibility checks on a small touch screen.
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      testMatch: /(phone|a11y)\.spec\.ts/,
    },
    ...(ALL_BROWSERS
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            testIgnore: OTHER_ENGINES_SKIP,
          },
          { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: OTHER_ENGINES_SKIP },
        ]
      : []),
  ],
  // The production build, as users get it (SPA fallback from `vite preview`).
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
});
