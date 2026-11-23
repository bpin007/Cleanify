import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Reading real workbooks takes about a second; room for slow CI runners.
    testTimeout: 20_000,
  },
});
