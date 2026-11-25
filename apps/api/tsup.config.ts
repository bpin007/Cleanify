import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the output.
  noExternal: [/^@cleanify\//],
  // The dev-only in-memory MongoDB stays outside the bundle (and out of production).
  external: ['mongodb-memory-server'],
});
