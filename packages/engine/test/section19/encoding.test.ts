/**
 * Section 19 — encoding detection bugs #16 and #18.
 */
import { describe, expect, it } from 'vitest';
import { decode, detectEncoding } from '../../src/index';
import { bytes, utf16 } from '../helpers';

describe('#16 UTF-16 without a BOM is detected', () => {
  const text = 'Hello, world — Grüße\nline 2\n';

  it('detects UTF-16LE without BOM and decodes it', () => {
    const b = utf16(text, 'le');
    expect(detectEncoding(b)).toMatchObject({ encoding: 'utf-16le', bomCount: 0 });
    expect(decode(b).text).toBe(text);
  });

  it('detects UTF-16BE without BOM and decodes it', () => {
    const b = utf16(text, 'be');
    expect(detectEncoding(b)).toMatchObject({ encoding: 'utf-16be', bomCount: 0 });
    expect(decode(b).text).toBe(text);
  });

  it('still honours BOMs (UTF-16LE/BE, UTF-32LE/BE)', () => {
    expect(detectEncoding(bytes([0xff, 0xfe], utf16('hi', 'le'))).encoding).toBe('utf-16le');
    expect(detectEncoding(bytes([0xfe, 0xff], utf16('hi', 'be'))).encoding).toBe('utf-16be');
    expect(detectEncoding(bytes([0xff, 0xfe, 0, 0, 0x68, 0, 0, 0])).encoding).toBe('utf-32le');
    expect(detectEncoding(bytes([0, 0, 0xfe, 0xff, 0, 0, 0, 0x68])).encoding).toBe('utf-32be');
  });
});

describe('#18 detection never cuts a character and reports low confidence', () => {
  it('a multi-byte character straddling the 4 KB mark is still UTF-8', () => {
    const b = bytes('a'.repeat(4095), 'é', 'b'.repeat(100)); // é = C3 A9 at bytes 4095–4096
    expect(detectEncoding(b)).toMatchObject({ encoding: 'utf-8', confidence: 'high' });
    expect(decode(b).text).toBe('a'.repeat(4095) + 'é' + 'b'.repeat(100));
  });

  it('a Windows-1252 byte far beyond the first 4 KB is still found', () => {
    const b = bytes('a'.repeat(70_000), [0x93], 'quoted', [0x94], '\n'); // “quoted”
    expect(detectEncoding(b).encoding).toBe('windows-1252');
    expect(decode(b).text.endsWith('“quoted”\n')).toBe(true);
  });

  it('reports low confidence (with a warning) for a tiny ambiguous file', () => {
    const b = bytes('caf', [0xe9]);
    expect(detectEncoding(b)).toMatchObject({ encoding: 'windows-1252', confidence: 'low' });
    expect(decode(b).warnings).toContainEqual(
      expect.objectContaining({ kind: 'low-confidence-encoding' }),
    );
  });

  it('plain ASCII is UTF-8 with high confidence', () => {
    expect(detectEncoding(bytes('just ascii\n'))).toMatchObject({
      encoding: 'utf-8',
      confidence: 'high',
      bomCount: 0,
    });
  });
});
