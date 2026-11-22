import { describe, expect, it } from 'vitest';
import type { SourceInfo } from '../src/engine/protocol';
import { saveOptions } from '../src/lib/save';

const source = (over: Partial<SourceInfo>): SourceInfo => ({
  name: 'a.txt',
  format: 'text',
  encoding: 'utf-8',
  bomCount: 0,
  confidence: 'high',
  encodingReason: null,
  delimiter: null,
  bytes: 1,
  ...over,
});

describe('saveOptions (decision D1)', () => {
  it('puts the suggested encoding first and marks the input encoding', () => {
    const opts = saveOptions(source({ encoding: 'windows-1252' }), 'utf-8');
    expect(opts.map((o) => o.label)).toEqual([
      'UTF-8',
      'UTF-8 with BOM',
      'Windows-1252 (same as the input)',
      'UTF-16 LE',
    ]);
  });

  it('keeps the input BOM when saving in the input encoding', () => {
    const opts = saveOptions(source({ encoding: 'utf-8', bomCount: 1 }), 'utf-8');
    expect(opts[0]).toMatchObject({ encoding: 'utf-8', bomCount: 1 });
    expect(opts[0]!.label).toBe('UTF-8 with BOM (same as the input)');
  });

  it('writes UTF-16 with a BOM and offers pasted text UTF-8 first', () => {
    expect(saveOptions(source({ encoding: 'utf-16be', bomCount: 1 }), 'utf-16be')[0]).toMatchObject(
      {
        encoding: 'utf-16be',
        bomCount: 1,
      },
    );
    expect(saveOptions(source({ encoding: null }), 'utf-8')[0]!.key).toBe('utf-8:0');
  });

  it('skips encodings the browser cannot write yet (Shift-JIS until iconv-lite)', () => {
    const opts = saveOptions(source({ encoding: 'shift_jis' }), 'shift_jis');
    expect(opts.some((o) => o.encoding === 'shift_jis')).toBe(false);
    expect(opts[0]!.encoding).toBe('utf-8');
  });
});
