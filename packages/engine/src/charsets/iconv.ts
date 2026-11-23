/**
 * Encoder for the encodings the engine can't write itself (Shift-JIS), backed by
 * iconv-lite (decision D1). Loaded lazily: only when the user saves in one of them.
 *
 * iconv-lite silently writes "?" for characters the encoding doesn't have, so every
 * result is decoded again and compared; characters that don't survive block the save
 * (UnencodableError), exactly like the built-in encoders.
 */
import { ensureBuffer } from '../formats/workbook';
import type IconvLite from 'iconv-lite';
import type { EncodingName } from '../types';
import { UnencodableError, type ExternalEncoder, type UnencodableChar } from './encode';

export async function loadIconvEncoder(): Promise<ExternalEncoder> {
  await ensureBuffer();
  const mod = (await import('iconv-lite')) as unknown as {
    default?: typeof IconvLite;
  } & typeof IconvLite;
  const iconv = mod.default ?? mod;
  return (text: string, encoding: EncodingName) => {
    const bytes = iconv.encode(text, encoding);
    if (iconv.decode(bytes, encoding) !== text) {
      const bad: UnencodableChar[] = [];
      let offset = 0;
      for (const ch of text) {
        if (iconv.decode(iconv.encode(ch, encoding), encoding) !== ch)
          bad.push({ char: ch, offset });
        offset += ch.length;
      }
      if (bad.length > 0) throw new UnencodableError(encoding, bad);
    }
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  };
}
