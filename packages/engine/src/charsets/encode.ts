import { bomBytes } from '../decode/detect';
import type { EncodingName } from '../types';
import { cp1252Byte } from './cp1252';
import { encodeUtf8 } from './utf8';

/** A character the target encoding can't hold (decision D1: block the save, list them). */
export interface UnencodableChar {
  char: string;
  /** UTF-16 offset in the text. */
  offset: number;
}

export class UnencodableError extends Error {
  constructor(
    readonly encoding: EncodingName,
    readonly chars: UnencodableChar[],
  ) {
    super(
      `${chars.length} character(s) can't be saved as ${encoding.toUpperCase()}: ` +
        [...new Set(chars.map((c) => c.char))].slice(0, 10).join(' '),
    );
    this.name = 'UnencodableError';
  }
}

/**
 * Pluggable encoder for encodings the engine can't write itself (Shift-JIS…).
 * The web app supplies one backed by a lazily loaded iconv-lite (decision D1).
 */
export type ExternalEncoder = (text: string, encoding: EncodingName) => Uint8Array;

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    out[i * 2] = littleEndian ? u & 0xff : u >> 8;
    out[i * 2 + 1] = littleEndian ? u >> 8 : u & 0xff;
  }
  return out;
}

function encodeUtf32(text: string, littleEndian: boolean): Uint8Array {
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const out = new Uint8Array(cps.length * 4);
  cps.forEach((cp, i) => {
    const b = [cp >>> 24, (cp >> 16) & 0xff, (cp >> 8) & 0xff, cp & 0xff];
    out.set(littleEndian ? b.reverse() : b, i * 4);
  });
  return out;
}

function encodeCp1252(text: string): Uint8Array {
  const out: number[] = [];
  const bad: UnencodableChar[] = [];
  let offset = 0;
  for (const ch of text) {
    const b = cp1252Byte(ch.codePointAt(0)!);
    if (b === undefined) bad.push({ char: ch, offset });
    else out.push(b);
    offset += ch.length;
  }
  if (bad.length > 0) throw new UnencodableError('windows-1252', bad);
  return Uint8Array.from(out);
}

export function encodeText(
  text: string,
  encoding: EncodingName,
  bomCount = 0,
  external?: ExternalEncoder,
): Uint8Array {
  let body: Uint8Array;
  switch (encoding) {
    case 'utf-8':
      body = encodeUtf8(text);
      break;
    case 'utf-16le':
    case 'utf-16be':
      body = encodeUtf16(text, encoding === 'utf-16le');
      break;
    case 'utf-32le':
    case 'utf-32be':
      body = encodeUtf32(text, encoding === 'utf-32le');
      break;
    case 'windows-1252':
      body = encodeCp1252(text);
      break;
    case 'shift_jis':
      if (!external) {
        throw new Error('Saving as Shift-JIS needs an external encoder (iconv-lite, decision D1)');
      }
      body = external(text, encoding);
      break;
  }
  const bom = bomBytes(encoding);
  const out = new Uint8Array(bom.length * bomCount + body.length);
  for (let i = 0; i < bomCount; i++) out.set(bom, i * bom.length);
  out.set(body, bom.length * bomCount);
  return out;
}
