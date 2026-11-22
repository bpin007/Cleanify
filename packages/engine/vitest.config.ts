import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      // Phase 1 target (PROJECT.md section 20): 90%+ before any UI work.
      // Enforced from Phase 1 onwards; Phase 0 has no engine code yet.
    },
  },
});
