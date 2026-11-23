import { describe, expect, it } from 'vitest';
import type { SourceInfo } from '@cleanify/session';
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
  sheetSource: null,
  sheetCount: null,
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
      'Shift-JIS',
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

  it('offers Shift-JIS (written by lazily loaded iconv-lite) first for a Shift-JIS file', () => {
    const opts = saveOptions(source({ encoding: 'shift_jis' }), 'shift_jis');
    expect(opts[0]).toMatchObject({ encoding: 'shift_jis', bomCount: 0 });
    expect(opts[0]!.label).toBe('Shift-JIS (same as the input)');
    expect(opts.filter((o) => o.encoding === 'shift_jis')).toHaveLength(1);
  });
});
