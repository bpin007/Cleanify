import { isCp1252Typographic } from '../charsets/cp1252';
import { validateUtf8 } from '../charsets/utf8';
import type { Confidence, EncodingName, EncodingResult } from '../types';

const BOMS: { encoding: EncodingName; bytes: number[] }[] = [
  // UTF-32 first: its LE BOM starts with the UTF-16 LE BOM.
  { encoding: 'utf-32le', bytes: [0xff, 0xfe, 0x00, 0x00] },
  { encoding: 'utf-32be', bytes: [0x00, 0x00, 0xfe, 0xff] },
  { encoding: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
  { encoding: 'utf-16le', bytes: [0xff, 0xfe] },
  { encoding: 'utf-16be', bytes: [0xfe, 0xff] },
];

export function bomBytes(encoding: EncodingName): number[] {
  return BOMS.find((b) => b.encoding === encoding)?.bytes ?? [];
}

function startsWith(bytes: Uint8Array, prefix: number[], at = 0): boolean {
  if (at + prefix.length > bytes.length) return false;
  return prefix.every((b, i) => bytes[at + i] === b);
}

/** How many BOMs of `encoding` sit back to back at the start (section 19 #9). */
export function countBoms(bytes: Uint8Array, encoding: EncodingName): number {
  const bom = bomBytes(encoding);
  if (bom.length === 0) return 0;
  let n = 0;
  while (startsWith(bytes, bom, n * bom.length)) n++;
  return n;
}

/** UTF-16 without a BOM, from the pattern of zero bytes (section 19 #16). */
function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 65536) & ~1;
  if (n < 4) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) zeroEven++;
    if (bytes[i + 1] === 0) zeroOdd++;
  }
  const pairs = n / 2;
  if (zeroOdd / pairs > 0.3 && zeroEven / pairs < 0.05) return 'utf-16le';
  if (zeroEven / pairs > 0.3 && zeroOdd / pairs < 0.05) return 'utf-16be';
  return null;
}

/**
 * Checks Shift-JIS byte grammar. `pairs` = double-byte characters; `kana` = those that
 * are hiragana/katakana (lead byte 0x82/0x83), which almost every Japanese sentence has.
 */
function scanShiftJis(bytes: Uint8Array): { valid: boolean; pairs: number; kana: number } {
  let pairs = 0;
  let kana = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 0x80 || (b >= 0xa1 && b <= 0xdf)) continue; // ASCII or half-width katakana
    const isLead = (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
    const t = bytes[i + 1];
    const isTrail = t !== undefined && ((t >= 0x40 && t <= 0x7e) || (t >= 0x80 && t <= 0xfc));
    if (!isLead || !isTrail) return { valid: false, pairs, kana };
    pairs++;
    if (b === 0x82 || b === 0x83) kana++;
    i++;
  }
  return { valid: true, pairs, kana };
}

/**
 * Detects the encoding of a whole file. It looks at every byte (UTF-8 validation
 * has no window), so a character is never cut in half (section 19 #18).
 */
export function detectEncoding(bytes: Uint8Array): EncodingResult {
  for (const { encoding, bytes: bom } of BOMS) {
    if (startsWith(bytes, bom)) {
      return {
        encoding,
        bomCount: countBoms(bytes, encoding),
        confidence: 'high',
        reason: `Byte order mark for ${encoding.toUpperCase()}`,
      };
    }
  }

  const utf16 = guessUtf16(bytes);
  if (utf16) {
    return {
      encoding: utf16,
      bomCount: 0,
      confidence: 'medium',
      reason: `No byte order mark, but the zero bytes follow the ${utf16.toUpperCase()} pattern`,
    };
  }

  const utf8 = validateUtf8(bytes);
  if (utf8.valid) {
    return {
      encoding: 'utf-8',
      bomCount: 0,
      confidence: 'high',
      reason: utf8.nonAscii === 0 ? 'Plain ASCII (also valid UTF-8)' : 'Valid UTF-8',
    };
  }

  let high = 0;
  let typographic = 0;
  for (const b of bytes) {
    if (b >= 0x80) high++;
    if (isCp1252Typographic(b)) typographic++;
  }

  const sjis = scanShiftJis(bytes);
  // Windows-1252 text like “Café” is often valid Shift-JIS grammar too, so also require kana.
  const looksJapanese = sjis.kana >= Math.max(1, sjis.pairs * 0.2);
  if (sjis.valid && sjis.pairs >= 2 && sjis.pairs * 2 >= high * 0.9 && looksJapanese) {
    const confidence: Confidence = sjis.pairs >= 10 ? 'medium' : 'low';
    return {
      encoding: 'shift_jis',
      bomCount: 0,
      confidence,
      reason: 'Not valid UTF-8; the bytes form valid Shift-JIS characters, including kana',
    };
  }

  const confidence: Confidence = typographic > 0 || high >= 3 ? 'medium' : 'low';
  return {
    encoding: 'windows-1252',
    bomCount: 0,
    confidence,
    reason: 'Not valid UTF-8; read as Windows-1252 (a superset of Latin-1)',
  };
}
