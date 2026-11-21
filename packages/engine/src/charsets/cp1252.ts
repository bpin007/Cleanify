/**
 * Windows-1252, implemented as a table.
 *
 * We don't use TextDecoder('windows-1252'): Node maps that label to Latin-1, so
 * 0x80 decodes to U+0080 instead of €. The five bytes Windows-1252 leaves
 * undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the C1 control with the same
 * number, which is what real-world mojibake contains.
 */

// prettier-ignore
const HIGH: readonly string[] = [
  '€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u008D', 'Ž', '\u008F',
  '\u0090', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u009D', 'ž', 'Ÿ',
];

const DECODE: readonly string[] = Array.from({ length: 256 }, (_, b) =>
  b >= 0x80 && b <= 0x9f ? HIGH[b - 0x80]! : String.fromCharCode(b),
);

const ENCODE = new Map<number, number>(DECODE.map((ch, b) => [ch.codePointAt(0)!, b]));

/** The byte for a code point in Windows-1252, or undefined if it has none. */
export function cp1252Byte(codePoint: number): number | undefined {
  return ENCODE.get(codePoint);
}

export function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += DECODE[bytes[i]!];
  return out;
}

/** Typographic bytes 0x80–0x9F that Windows-1252 defines (excludes the 5 undefined ones). */
export function isCp1252Typographic(byte: number): boolean {
  return byte >= 0x80 && byte <= 0x9f && ![0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(byte);
}
