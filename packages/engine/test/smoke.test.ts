import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

// Phase 0 smoke test: proves the package builds, resolves and runs under Vitest.
// Real engine tests (section 19 fixtures first, as failing tests) start in Phase 1.
describe('@cleanify/engine skeleton', () => {
  it('exports a version string', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
