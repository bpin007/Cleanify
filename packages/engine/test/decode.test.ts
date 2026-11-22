/**
 * Encoding detection, decoding and encoding beyond the section 19 cases.
 */
import { describe, expect, it } from 'vitest';
import { decode, detectEncoding, encodeText, UnencodableError } from '../src/index';
import { bytes, utf16 } from './helpers';

describe('decode', () => {
  it('decodes every Windows-1252 typographic byte correctly (not as Latin-1)', () => {
    const b = bytes([0x80, 0x85, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97, 0x99, 0xe9]);
    expect(decode(b, 'windows-1252').text).toBe('€…‘’“”–—™é');
  });

  it('detects and decodes Shift-JIS', () => {
    // 日本語のテキストです。(Shift-JIS bytes)
    const sjis = bytes([
      0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x83, 0x65, 0x83, 0x4c, 0x83, 0x58, 0x83,
      0x67, 0x82, 0xc5, 0x82, 0xb7, 0x81, 0x42,
    ]);
    const d = decode(sjis);
    expect(d.encoding).toBe('shift_jis');
    expect(d.text).toBe('日本語のテキストです。');
  });

  it('decodes UTF-32 with a BOM, including astral characters', () => {
    const le = bytes([0xff, 0xfe, 0, 0], [0x00, 0xf6, 0x01, 0x00], [0x41, 0, 0, 0]);
    expect(decode(le).text).toBe('😀A');
    const be = bytes([0, 0, 0xfe, 0xff], [0x00, 0x01, 0xf6, 0x00], [0, 0, 0, 0x41]);
    expect(decode(be).text).toBe('😀A');
  });

  it('replaces invalid UTF-32 code points and dangling bytes with U+FFFD', () => {
    expect(decode(bytes([0xff, 0xfe, 0, 0], [0xff, 0xff, 0xff, 0x7f], [0x41])).text).toBe('��');
  });

  it('marks a dangling odd UTF-16 byte with U+FFFD', () => {
    expect(decode(bytes([0xff, 0xfe], utf16('hi', 'le'), [0x41])).text).toBe('hi�');
  });

  it('honours an encoding chosen by the user and counts its BOMs', () => {
    const d = decode(bytes([0xef, 0xbb, 0xbf], 'x'), 'utf-8');
    expect(d).toMatchObject({ text: 'x', bomCount: 1, confidence: 'high', warnings: [] });
  });

  it('marks invalid UTF-8 as U+FFFD when UTF-8 is forced', () => {
    expect(decode(bytes('a', [0xff], 'b'), 'utf-8').text).toBe('a�b');
  });

  it('does not mistake Windows-1252 text for Shift-JIS', () => {
    // “Café” in Windows-1252
    expect(detectEncoding(bytes([0x93], 'Caf', [0xe9, 0x94])).encoding).toBe('windows-1252');
  });

  it('explains why it picked an encoding', () => {
    expect(detectEncoding(bytes('ascii')).reason).toMatch(/ASCII/);
    expect(detectEncoding(bytes('é')).reason).toMatch(/UTF-8/);
  });
});

describe('encodeText', () => {
  const sample = 'Grüße “x” – 😀';

  it.each(['utf-8', 'utf-16le', 'utf-16be', 'utf-32le', 'utf-32be'] as const)(
    'round-trips %s with BOMs',
    (enc) => {
      const out = encodeText(sample, enc, 1);
      const d = decode(out);
      expect(d).toMatchObject({ text: sample, encoding: enc, bomCount: 1 });
    },
  );

  it('writes Windows-1252 and blocks characters that do not fit (decision D1)', () => {
    expect(decode(encodeText('Café “ok” €', 'windows-1252'), 'windows-1252').text).toBe(
      'Café “ok” €',
    );
    try {
      encodeText('ok 中 and 😀', 'windows-1252');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnencodableError);
      expect((e as UnencodableError).chars).toEqual([
        { char: '中', offset: 3 },
        { char: '😀', offset: 9 },
      ]);
    }
  });

  it('needs an external encoder for Shift-JIS and uses it when given', () => {
    expect(() => encodeText('日本', 'shift_jis')).toThrow(/external encoder/);
    const fake = () => Uint8Array.from([1, 2]);
    expect([...encodeText('日本', 'shift_jis', 0, fake)]).toEqual([1, 2]);
  });
});
