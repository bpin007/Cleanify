import { describe, expect, it } from 'vitest';
import { isHealthResponse } from '../src/index';

describe('isHealthResponse', () => {
  it('accepts a valid health body', () => {
    expect(isHealthResponse({ status: 'ok', name: 'Cleanify', version: '0.0.0' })).toBe(true);
  });

  it.each([
    null,
    undefined,
    'ok',
    {},
    { status: 'down', name: 'x', version: '1' },
    { status: 'ok' },
  ])('rejects %j', (value) => {
    expect(isHealthResponse(value)).toBe(false);
  });
});
