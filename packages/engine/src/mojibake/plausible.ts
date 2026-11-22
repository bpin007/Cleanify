/**
 * Plausibility of a character produced by a mojibake repair (section 5, Stage 1 step 3:
 * "must not turn ordinary letters into rare symbols").
 *
 * - `common`: accepted on its own (Latin-1, Latin Extended-A, Romanian ș/ț, typographic
 *   punctuation, symbols, emoji).
 * - a script name: a letter from a non-Latin script; accepted only with corroboration
 *   (≥ 2 such characters repaired together, or the script already in the text).
 * - `combining`: a common combining accent; accepted only right after an ASCII letter.
 * - `reject`: never produced by a repair (C1 controls, IPA, rare Latin Extended-B,
 *   private use, noncharacters…). This is what keeps «CAFÉ» from becoming «CAFɻ» (#11).
 */
export type Plausibility =
  | 'common'
  | 'transient'
  | 'combining'
  | 'reject'
  | 'greek'
  | 'cyrillic'
  | 'armenian'
  | 'hebrew'
  | 'arabic'
  | 'syriac'
  | 'indic'
  | 'thai'
  | 'latin-ext'
  | 'cjk'
  | 'kana'
  | 'hangul'
  | 'other';

const COMMON_COMBINING = new Set([
  0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0306, 0x0307, 0x0308, 0x030a, 0x030b, 0x030c, 0x0327,
  0x0328,
]);

const between = (cp: number, lo: number, hi: number) => cp >= lo && cp <= hi;

/** The C1 controls that stand for the 5 bytes Windows-1252 leaves undefined. */
const CP1252_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

/** Windows-1252 characters outside the "common" ranges; their mojibake is real-world. */
const CP1252_EXTRAS = new Set([0x0192, 0x02c6, 0x02dc]); // ƒ ˆ ˜

export function plausibility(cp: number): Plausibility {
  // Two-byte range (U+0080–U+07FF)
  // An undefined-byte C1 control can only be an intermediate step of garbled-twice text
  // (e.g. ” → â€\u009D → Ã¢â‚¬Â\u009D); it must never survive into a final repair.
  if (CP1252_UNDEFINED.has(cp)) return 'transient';
  if (CP1252_EXTRAS.has(cp)) return 'common';
  if (cp < 0xa0) return 'reject'; // other C1 controls
  if (cp <= 0x17f) return 'common'; // Latin-1 Supplement + Latin Extended-A
  if (between(cp, 0x218, 0x21b)) return 'common'; // Romanian Ș ș Ț ț
  if (cp <= 0x2ff) return 'reject'; // rare Latin Extended-B, IPA, spacing modifiers
  if (cp <= 0x36f) return COMMON_COMBINING.has(cp) ? 'combining' : 'reject';
  if (cp <= 0x3ff) return 'greek';
  if (cp <= 0x52f) return 'cyrillic';
  if (cp <= 0x58f) return 'armenian';
  if (cp <= 0x5ff) return 'hebrew';
  if (cp <= 0x6ff || between(cp, 0x750, 0x77f)) return 'arabic';
  if (cp <= 0x7ff) return 'syriac'; // Syriac, Thaana, NKo
  // Three-byte range (U+0800–U+FFFF)
  if (between(cp, 0x900, 0xdff)) return 'indic';
  if (between(cp, 0xe00, 0xe7f)) return 'thai';
  if (between(cp, 0x1e00, 0x1eff)) return 'latin-ext'; // Vietnamese and other Latin Extended Additional
  if (between(cp, 0x2000, 0x2bff)) return 'common'; // punctuation, currency, ™, arrows, math, symbols
  if (between(cp, 0x3040, 0x30ff) || between(cp, 0x31f0, 0x31ff)) return 'kana';
  if (
    between(cp, 0x3000, 0x303f) ||
    between(cp, 0x3400, 0x4dbf) ||
    between(cp, 0x4e00, 0x9fff) ||
    between(cp, 0xf900, 0xfaff) ||
    between(cp, 0xff00, 0xffef)
  ) {
    return 'cjk';
  }
  if (between(cp, 0xac00, 0xd7af) || between(cp, 0x1100, 0x11ff) || between(cp, 0x3130, 0x318f)) {
    return 'hangul';
  }
  if (between(cp, 0xe000, 0xf8ff) || between(cp, 0xfdd0, 0xfdef)) return 'reject'; // private use, nonchars
  if (cp === 0xfffd || cp === 0xfeff) return 'common'; // garbled U+FFFD / BOM: repaired, then flagged
  if (between(cp, 0xfff0, 0xffff)) return 'reject';
  if (cp <= 0xffff) return 'other';
  // Four-byte range
  if (between(cp, 0x1f000, 0x1faff)) return 'common'; // emoji, flags, symbols
  if (between(cp, 0x20000, 0x3ffff)) return 'cjk';
  return 'reject';
}

/** Script of a genuine (non-candidate) character, for corroboration. */
export function scriptOf(cp: number): Plausibility | null {
  if (cp < 0x80) return null;
  const p = plausibility(cp);
  return p === 'common' || p === 'reject' || p === 'combining' || p === 'transient' ? null : p;
}
