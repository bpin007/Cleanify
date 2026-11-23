/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

// mdb-reader's decryption code (browserify-aes → cipher-base) imports Node's
// "stream" and "events" when it loads. In the browser they come from these shims.
// Not in Vitest: tests run in Node, where ExcelJS needs the real modules.
const nodeShims = process.env['VITEST']
  ? []
  : [
      { find: /^stream$/, replacement: require.resolve('stream-browserify') },
      { find: /^events$/, replacement: require.resolve('events/') },
    ];

export default defineConfig(({ mode }) => {
  // Read VITE_* and API_PROXY_TARGET from the single repo-root .env.
  const env = loadEnv(mode, repoRoot, '');

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    resolve: { alias: nodeShims },
    // ES-module workers can code-split, so the transliterator (any-ascii, decision D7)
    // stays a separate chunk that loads only when transliteration is turned on.
    worker: { format: 'es' },
    // The worker's dependencies are only discovered when Clean is first pressed, and
    // Vite would then reload the page mid-run in dev. Pre-bundle them up front. They
    // are the engine's dependencies, hence the "@cleanify/engine > …" form.
    optimizeDeps: {
      include: [
        'papaparse',
        'any-ascii',
        'exceljs',
        'xlsx',
        'mdb-reader',
        'iconv-lite',
        'buffer',
      ].map((dep) => `@cleanify/engine > ${dep}`),
    },
    server: {
      port: 5173,
      strictPort: true,
      // The browser always calls same-origin /api/*. In development Vite forwards it
      // to the local API; in production a Cloudflare Pages Function does the same
      // (correction 6), so cookies stay first-party in both.
      proxy: {
        '/api': {
          target: env['API_PROXY_TARGET'] || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    test: {
      include: ['test/**/*.test.ts'],
    },
  };
});
