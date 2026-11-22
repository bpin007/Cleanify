import { decodeCp1252 } from '../charsets/cp1252';
import type { DecodedDoc, EncodingName, EngineWarning } from '../types';
import { bomBytes, countBoms, detectEncoding } from './detect';

interface TextDecoderLike {
  decode(input: Uint8Array): string;
}
type TextDecoderCtor = new (
  label: string,
  options?: { fatal?: boolean; ignoreBOM?: boolean },
) => TextDecoderLike;

/** TextDecoder exists in browsers, workers and Node; reached via globalThis to stay platform-neutral. */
function textDecoder(label: string): TextDecoderLike {
  const Ctor = (globalThis as unknown as { TextDecoder?: TextDecoderCtor }).TextDecoder;
  if (!Ctor) throw new Error('TextDecoder is not available in this environment');
  return new Ctor(label, { ignoreBOM: true });
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = '';
  const end = bytes.length & ~1;
  for (let i = 0; i < end; i += 2) {
    const unit = littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!;
    out += String.fromCharCode(unit);
  }
  if (bytes.length & 1) out += '�'; // dangling odd byte
  return out;
}

function decodeUtf32(bytes: Uint8Array, littleEndian: boolean): string {
  let out = '';
  const end = bytes.length & ~3;
  for (let i = 0; i < end; i += 4) {
    const [a, b, c, d] = [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!];
    const cp = littleEndian
      ? (d << 24) | (c << 16) | (b << 8) | a
      : (a << 24) | (b << 16) | (c << 8) | d;
    out +=
      cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
  }
  if (bytes.length & 3) out += '�';
  return out;
}

export function decodeBytes(bytes: Uint8Array, encoding: EncodingName): string {
  switch (encoding) {
    case 'utf-8':
      return textDecoder('utf-8').decode(bytes);
    case 'utf-16le':
      return decodeUtf16(bytes, true);
    case 'utf-16be':
      return decodeUtf16(bytes, false);
    case 'utf-32le':
      return decodeUtf32(bytes, true);
    case 'utf-32be':
      return decodeUtf32(bytes, false);
    case 'windows-1252':
      return decodeCp1252(bytes);
    case 'shift_jis':
      return textDecoder('shift_jis').decode(bytes);
  }
}

/**
 * Decodes bytes to text. Exactly one leading BOM is removed (it marks the encoding);
 * any extra BOMs stay in the text as U+FEFF so Stage 1 can report them (#9).
 */
export function decode(bytes: Uint8Array, encoding?: EncodingName): DecodedDoc {
  const detected = detectEncoding(bytes);
  const enc = encoding ?? detected.encoding;
  const bomCount = encoding ? countBoms(bytes, enc) : detected.bomCount;
  const confidence = encoding ? 'high' : detected.confidence;
  const body = bomCount > 0 ? bytes.subarray(bomBytes(enc).length) : bytes;

  const warnings: EngineWarning[] = [];
  if (confidence === 'low') {
    warnings.push({
      kind: 'low-confidence-encoding',
      severity: 'warning',
      message: `Not sure about the encoding: guessed ${enc.toUpperCase()}. ${detected.reason}. Check the preview, or choose the encoding yourself.`,
    });
  }

  return { text: decodeBytes(body, enc), encoding: enc, bomCount, confidence, warnings };
}
