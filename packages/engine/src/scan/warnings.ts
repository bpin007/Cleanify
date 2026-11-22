/**
 * Warnings that never change text and are reported whatever the stage toggles are:
 * data already lost (#8), hidden tag text (#6), bidi controls, look-alike letters (#10).
 */
import { emojiSequenceEnd } from '../ascii/emoji';
import { decodeTags, findConfusables } from '../ascii/stage2';
import type { FoundWarning } from '../proposal';

const BIDI = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

export function scanWarnings(text: string): FoundWarning[] {
  const out: FoundWarning[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    if (cp === 0x1f3f4) {
      // Subdivision flags legitimately contain tag characters.
      const end = emojiSequenceEnd(text, i);
      i = end > i ? end : i + 2;
      continue;
    }
    if (cp === 0xfffd) {
      out.push({
        kind: 'data-lost',
        severity: 'warning',
        message:
          'Replacement character � found: the original character was already lost before this file reached Cleanify and cannot be recovered.',
        offset: i,
      });
    } else if (cp >= 0xe0000 && cp <= 0xe007f) {
      let j = i;
      while (j < text.length && text.codePointAt(j)! >= 0xe0000 && text.codePointAt(j)! <= 0xe007f)
        j += 2;
      const hidden = decodeTags(text.slice(i, j));
      out.push({
        kind: 'hidden-text',
        severity: 'high',
        message: `Hidden text in invisible Unicode tag characters${hidden ? `: “${hidden}”` : ''}. This is sometimes used to smuggle instructions past people.`,
        offset: i,
      });
      i = j;
      continue;
    } else if (BIDI.has(cp)) {
      out.push({
        kind: 'bidi-control',
        severity: 'warning',
        message:
          'Text-direction control character found: it can make text display in a different order than it is stored.',
        offset: i,
      });
    }
    i += cp > 0xffff ? 2 : 1;
  }

  for (const w of findConfusables(text)) {
    out.push({
      kind: 'mixed-script',
      severity: 'warning',
      message:
        'A word mixes Latin letters with look-alike letters from another alphabet (possible spoofing).',
      offset: w.offsets[0]!,
    });
  }

  return out.sort((a, b) => a.offset - b.offset);
}
