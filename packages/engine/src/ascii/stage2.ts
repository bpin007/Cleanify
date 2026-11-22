/**
 * Stage 2 — accents and special characters → plain ASCII, plus invisible/control
 * cleanup (PROJECT.md section 5).
 */
import type { AsciiOptions } from '../types';
import type { Proposal } from '../proposal';
import { emojiSequenceEnd } from './emoji';
import {
  CONFUSABLES,
  EMOJI_TEXT,
  INVISIBLE,
  PUNCTUATION,
  SPACES,
  SPECIAL_LETTERS,
  SYMBOLS,
} from './tables';

export type Transliterator = (text: string) => string;

export interface Stage2Options extends AsciiOptions {
  /** Required when nonLatin is 'transliterate' (any-ascii, loaded lazily — see loadTransliterator). */
  transliterate?: Transliterator;
}

const hex = (cp: number) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const LATIN = /\p{Script=Latin}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const MARK = /\p{M}/u;
const isAsciiLetter = (c: string | undefined) => c !== undefined && /^[A-Za-z]$/.test(c);
const isNonLatinLetter = (c: string | undefined) =>
  c !== undefined && /\p{L}/u.test(c) && !LATIN.test(c);

function charBefore(text: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const cp = text.codePointAt(i - 1)!;
  return cp >= 0xdc00 && cp <= 0xdfff && i >= 2
    ? String.fromCodePoint(text.codePointAt(i - 2)!)
    : String.fromCodePoint(cp);
}

function charAt(text: string, i: number): string | undefined {
  return i < text.length ? String.fromCodePoint(text.codePointAt(i)!) : undefined;
}

/** Decodes tag characters to the ASCII they hide (U+E0041 → 'A'). */
export function decodeTags(run: string): string {
  return [...run]
    .map((c) => c.codePointAt(0)! - 0xe0000)
    .filter((cp) => cp >= 0x20 && cp < 0x7f)
    .map((cp) => String.fromCharCode(cp))
    .join('');
}

/**
 * Words that mix Latin letters with look-alike Cyrillic/Greek letters (#10).
 * Returns the offsets of the look-alike characters, grouped by word.
 */
export function findConfusables(text: string): { offsets: number[] }[] {
  const words: { offsets: number[] }[] = [];
  const re = /[\p{L}\p{M}]+/gu;
  for (const m of text.matchAll(re)) {
    const word = m[0];
    let hasLatin = false;
    const offsets: number[] = [];
    let k = 0;
    for (const ch of word) {
      if (/[A-Za-z]/.test(ch) || (LATIN.test(ch) && !CONFUSABLES.has(ch))) hasLatin = true;
      else if (CONFUSABLES.has(ch)) offsets.push(m.index + k);
      k += ch.length;
    }
    if (hasLatin && offsets.length > 0) words.push({ offsets });
  }
  return words;
}

export function findStage2(text: string, options: Stage2Options = {}): Proposal[] {
  const out: Proposal[] = [];
  const add = (
    start: number,
    end: number,
    to: string,
    stage: 'ascii' | 'invisible',
    kind: string,
    reason: string,
    extra: Partial<Proposal> = {},
  ) => {
    out.push({
      start,
      end,
      from: text.slice(start, end),
      to,
      stage,
      kind,
      reason,
      confidence: 'high',
      ...extra,
    });
  };

  // Look-alike letters first, so they aren't also transliterated.
  const confusableAt = new Set<number>();
  for (const w of findConfusables(text)) {
    for (const off of w.offsets) {
      confusableAt.add(off);
      const ch = charAt(text, off)!;
      const script = /[Ͱ-Ͽ]/.test(ch) ? 'Greek' : 'Cyrillic';
      add(
        off,
        off + ch.length,
        CONFUSABLES.get(ch)!,
        'ascii',
        'confusable',
        `${script} “${ch}” that looks like Latin “${CONFUSABLES.get(ch)}” (possible spoofing)`,
        { confidence: 'medium', accepted: false },
      );
    }
  }

  const translit = options.nonLatin === 'transliterate' ? options.transliterate : undefined;
  let runStart = -1; // start of a run of characters waiting for transliteration
  const flushRun = (end: number) => {
    if (runStart < 0 || !translit) return;
    const from = text.slice(runStart, end);
    const to = translit(from);
    if (to !== from)
      add(runStart, end, to, 'ascii', 'transliterate', 'Written in Latin letters (transliterated)');
    runStart = -1;
  };

  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const len = ch.length;

    // Emoji sequences (and keycaps, which start with an ASCII digit)
    const emojiEnd =
      cp < 0x80 && !(cp >= 0x30 && cp <= 0x39) && cp !== 0x23 && cp !== 0x2a
        ? -1
        : emojiSequenceEnd(text, i);
    if (emojiEnd > 0) {
      flushRun(i);
      const seq = text.slice(i, emojiEnd);
      if (options.emoji === 'remove') add(i, emojiEnd, '', 'ascii', 'emoji', 'Emoji removed');
      else if (options.emoji === 'text') {
        const t = EMOJI_TEXT.get(seq) ?? EMOJI_TEXT.get(ch) ?? (translit ? translit(seq) : '');
        add(i, emojiEnd, t, 'ascii', 'emoji', t ? 'Emoji written as text' : 'Emoji removed');
      }
      i = emojiEnd;
      continue;
    }

    if (cp < 0x80 && cp >= 0x20 && cp !== 0x7f) {
      flushRun(i);
      i++;
      continue;
    }

    if (confusableAt.has(i)) {
      flushRun(i);
      i += len;
      continue;
    }

    // Tag characters: one change per run, revealing what they hide (#6)
    if (cp >= 0xe0000 && cp <= 0xe007f) {
      flushRun(i);
      let j = i;
      while (j < text.length && text.codePointAt(j)! >= 0xe0000 && text.codePointAt(j)! <= 0xe007f)
        j += 2;
      const hidden = decodeTags(text.slice(i, j));
      add(
        i,
        j,
        '',
        'invisible',
        'tag-char',
        `Invisible Unicode tag characters${hidden ? ` hiding the text “${hidden}”` : ''}`,
      );
      i = j;
      continue;
    }

    // Control characters: C0 (except tab, LF, CR), DEL, C1 (#5)
    if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f)) {
      flushRun(i);
      add(i, i + 1, '', 'invisible', 'control', `Control character ${hex(cp)}`);
      i++;
      continue;
    }
    if (cp < 0x80) {
      flushRun(i);
      i++;
      continue;
    } // tab, LF, CR

    if (cp === 0xfeff) {
      flushRun(i);
      i++;
      continue;
    } // BOM: handled by Stage 1

    const inv = INVISIBLE.get(cp);
    if (inv) {
      // ZWJ/ZWNJ between letters of a non-Latin script are part of the spelling (Persian, Indic…)
      const joinerInWord =
        (cp === 0x200c || cp === 0x200d) &&
        isNonLatinLetter(charBefore(text, i)) &&
        isNonLatinLetter(charAt(text, i + 1));
      if (!joinerInWord) {
        flushRun(i);
        add(i, i + len, '', 'invisible', inv.kind, `Invisible character: ${inv.name} (${hex(cp)})`);
        i += len;
        continue;
      }
    }

    // Variation selectors after ASCII or at the start do nothing visible
    if (cp >= 0xfe00 && cp <= 0xfe0f) {
      const prev = charBefore(text, i);
      if (prev === undefined || prev.codePointAt(0)! < 0x80) {
        flushRun(i);
        add(
          i,
          i + 1,
          '',
          'invisible',
          'variation-selector',
          `Invisible variation selector (${hex(cp)})`,
        );
        i++;
        continue;
      }
    }

    const space = SPACES.get(cp);
    if (space) {
      flushRun(i);
      add(
        i,
        i + 1,
        ' ',
        'invisible',
        cp === 0xa0 || cp === 0x202f ? 'nbsp' : 'space',
        `${space[0]!.toUpperCase()}${space.slice(1)} → normal space`,
      );
      i++;
      continue;
    }

    if (ch === '«' || ch === '»') {
      flushRun(i);
      const to = options.guillemets === 'quote' ? '"' : ch === '«' ? '<<' : '>>';
      add(i, i + 1, to, 'ascii', 'smart-quote', `Guillemet ${ch} → ${to}`);
      i++;
      continue;
    }

    const punct = PUNCTUATION.get(ch);
    if (punct) {
      flushRun(i);
      add(
        i,
        i + len,
        punct.to,
        'ascii',
        punct.kind,
        `${ch === ' ' || ch === ' ' ? 'Line/paragraph separator' : ch} → ${JSON.stringify(punct.to).slice(1, -1)}`,
      );
      i += len;
      continue;
    }

    const sym = SYMBOLS.get(ch);
    if (sym !== undefined) {
      flushRun(i);
      add(i, i + len, sym, 'ascii', 'symbol', sym ? `${ch} → ${sym}` : `${ch} removed`);
      i += len;
      continue;
    }

    if (cp >= 0xff01 && cp <= 0xff5e) {
      flushRun(i);
      const to = String.fromCharCode(cp - 0xfee0);
      add(i, i + 1, to, 'ascii', 'fullwidth', `Full-width ${ch} → ${to}`);
      i++;
      continue;
    }

    const special = SPECIAL_LETTERS.get(ch);
    if (special) {
      flushRun(i);
      add(i, i + len, special, 'ascii', 'letter', `${ch} → ${special}`);
      i += len;
      continue;
    }

    if (LATIN.test(ch)) {
      const nfd = ch.normalize('NFD');
      const base = nfd[0];
      if (isAsciiLetter(base) && [...nfd.slice(1)].every((m) => MARK.test(m))) {
        flushRun(i);
        add(i, i + len, base!, 'ascii', 'accent', `${ch} → ${base}`);
        i += len;
        continue;
      }
    }

    // A bare combining accent after an ASCII letter (decomposed text, e.g. "é")
    if (MARK.test(ch) && isAsciiLetter(charBefore(text, i))) {
      flushRun(i);
      add(i, i + len, '', 'ascii', 'accent', `Combining accent ${hex(cp)} removed`);
      i += len;
      continue;
    }

    // Anything else that isn't ASCII: transliterate if asked, otherwise leave as is.
    if (translit && (LETTER_OR_MARK.test(ch) || !/\s/.test(ch))) {
      if (runStart < 0) runStart = i;
    } else {
      flushRun(i);
    }
    i += len;
  }
  flushRun(text.length);

  return out.sort((a, b) => a.start - b.start);
}
