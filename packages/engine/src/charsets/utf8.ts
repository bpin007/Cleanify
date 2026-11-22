/**
 * Strict UTF-8 helpers (RFC 3629): no overlongs, no surrogates, max U+10FFFF.
 */

/** Expected sequence length for a lead byte, or 0 if it can't start a sequence. */
export function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

/**
 * Decodes one strict UTF-8 sequence starting at `i`.
 * Returns the code point and its byte length, or null if the bytes are not valid UTF-8.
 */
export function decodeUtf8At(
  bytes: ArrayLike<number>,
  i: number,
): { codePoint: number; length: number } | null {
  const b0 = bytes[i];
  if (b0 === undefined) return null;
  const len = utf8SequenceLength(b0);
  if (len === 0 || i + len > bytes.length) return null;
  if (len === 1) return { codePoint: b0, length: 1 };

  const b1 = bytes[i + 1]!;
  // Second-byte ranges that rule out overlongs, surrogates and > U+10FFFF.
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 === 0xe0) lo = 0xa0;
  else if (b0 === 0xed) hi = 0x9f;
  else if (b0 === 0xf0) lo = 0x90;
  else if (b0 === 0xf4) hi = 0x8f;
  if (b1 < lo || b1 > hi) return null;

  let cp = b0 & (len === 2 ? 0x1f : len === 3 ? 0x0f : 0x07);
  cp = (cp << 6) | (b1 & 0x3f);
  for (let k = 2; k < len; k++) {
    const b = bytes[i + k]!;
    if (b < 0x80 || b > 0xbf) return null;
    cp = (cp << 6) | (b & 0x3f);
  }
  return { codePoint: cp, length: len };
}

/** Validates the whole buffer as strict UTF-8 (no window, so no character is ever cut). */
export function validateUtf8(bytes: Uint8Array): { valid: boolean; nonAscii: number } {
  let nonAscii = 0;
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i]! < 0x80) {
      i++;
      continue;
    }
    const seq = decodeUtf8At(bytes, i);
    if (!seq) return { valid: false, nonAscii };
    nonAscii++;
    i += seq.length;
  }
  return { valid: true, nonAscii };
}

export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(out);
}
