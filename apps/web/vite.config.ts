/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Read VITE_* and API_PROXY_TARGET from the single repo-root .env.
  const env = loadEnv(mode, repoRoot, '');

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
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
