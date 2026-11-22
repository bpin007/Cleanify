import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // PROJECT.md section 20: 90%+ before any UI work. CI fails below this.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
