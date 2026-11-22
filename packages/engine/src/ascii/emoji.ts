/**
 * Emoji sequences are handled as one unit, so the joiners, variation selectors and
 * tag characters inside them are never stripped as "invisible" characters.
 */

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isSkinTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007f;
const isKeycapBase = (cp: number) => (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;

function cpAt(text: string, i: number): number | undefined {
  return i < text.length ? text.codePointAt(i) : undefined;
}
const width = (cp: number) => (cp > 0xffff ? 2 : 1);

/** End offset of the emoji sequence starting at `i`, or -1 if none starts there. */
export function emojiSequenceEnd(text: string, i: number): number {
  const base = cpAt(text, i);
  if (base === undefined) return -1;

  // Keycap: 1️⃣ = digit + (FE0F) + U+20E3
  if (isKeycapBase(base)) {
    let j = i + 1;
    if (cpAt(text, j) === 0xfe0f) j++;
    return cpAt(text, j) === 0x20e3 ? j + 1 : -1;
  }

  // Flag: two regional indicators
  if (isRegionalIndicator(base)) {
    const next = cpAt(text, i + 2);
    return next !== undefined && isRegionalIndicator(next) ? i + 4 : i + 2;
  }

  if (!PICTOGRAPHIC.test(String.fromCodePoint(base))) return -1;
  // ©, ®, ™, ❤ … are pictographic but display as text unless followed by U+FE0F.
  const next = cpAt(text, i + width(base));
  const emojiStyle =
    EMOJI_PRESENTATION.test(String.fromCodePoint(base)) ||
    next === 0xfe0f ||
    (next !== undefined && isSkinTone(next));
  if (!emojiStyle) return -1;

  let j = i + width(base);
  for (;;) {
    const cp = cpAt(text, j);
    if (cp === undefined) break;
    if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x20e3 || isSkinTone(cp)) {
      j += width(cp);
    } else if (isTag(cp) && base === 0x1f3f4) {
      // Subdivision flags (🏴 + tag letters + cancel tag), e.g. Scotland
      j += 2;
    } else if (cp === 0x200d) {
      const after = cpAt(text, j + 1);
      if (after !== undefined && PICTOGRAPHIC.test(String.fromCodePoint(after))) {
        j += 1 + width(after);
      } else break;
    } else break;
  }
  return j;
}
