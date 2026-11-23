/**
 * Invisible and look-alike-space characters drawn as visible markers in the text
 * panels (PROJECT.md section 9: `·NBSP·`, `⟨ZWSP⟩`).
 */

const NAMES: Record<number, string> = {
  0x00a0: 'NBSP',
  0x00ad: 'SHY',
  0x034f: 'CGJ',
  0x061c: 'ALM',
  0x1680: 'OGHAM SP',
  0x180e: 'MVS',
  0x2000: 'EN QUAD',
  0x2001: 'EM QUAD',
  0x2002: 'ENSP',
  0x2003: 'EMSP',
  0x2004: '3/EMSP',
  0x2005: '4/EMSP',
  0x2006: '6/EMSP',
  0x2007: 'FIGSP',
  0x2008: 'PUNCSP',
  0x2009: 'THINSP',
  0x200a: 'HAIRSP',
  0x200b: 'ZWSP',
  0x200c: 'ZWNJ',
  0x200d: 'ZWJ',
  0x200e: 'LRM',
  0x200f: 'RLM',
  0x2028: 'LSEP',
  0x2029: 'PSEP',
  0x202a: 'LRE',
  0x202b: 'RLE',
  0x202c: 'PDF',
  0x202d: 'LRO',
  0x202e: 'RLO',
  0x202f: 'NNBSP',
  0x205f: 'MMSP',
  0x2060: 'WJ',
  0x2061: 'FA',
  0x2062: 'IT',
  0x2063: 'IS',
  0x2064: 'IP',
  0x2066: 'LRI',
  0x2067: 'RLI',
  0x2068: 'FSI',
  0x2069: 'PDI',
  0x3000: 'IDSP',
  0xfeff: 'BOM',
  0xfffc: 'OBJ',
};

/** Space-like characters get the dotted `·NAME·` form, the rest `⟨NAME⟩`. */
const SPACE_LIKE = new Set([
  0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
  0x200a, 0x202f, 0x205f, 0x3000,
]);

export type Piece = { text: string; marker: false } | { text: string; marker: true; title: string };

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** The marker for one code point, or null if it is visible as it is. */
export function markerFor(cp: number): string | null {
  const name = NAMES[cp];
  if (name) return SPACE_LIKE.has(cp) ? `·${name}·` : `⟨${name}⟩`;
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return null;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return `⟨${hex(cp)}⟩`; // control characters
  if (cp >= 0xe0000 && cp <= 0xe007f) return `⟨TAG ${hex(cp)}⟩`; // hidden tag characters
  if (cp >= 0xfe00 && cp <= 0xfe0f) return null; // variation selectors belong to emoji
  return null;
}

/** Splits text into plain runs and visible markers. */
export function withMarkers(text: string): Piece[] {
  const out: Piece[] = [];
  let run = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const m = markerFor(cp);
    if (m === null) {
      run += ch;
      continue;
    }
    if (run) out.push({ text: run, marker: false });
    run = '';
    out.push({ text: m, marker: true, title: `${hex(cp)} (invisible character)` });
  }
  if (run) out.push({ text: run, marker: false });
  return out;
}

/** Plain-text form with markers, for labels like the change list (`a·NBSP·b`). */
export const showInvisible = (text: string) =>
  withMarkers(text)
    .map((p) => p.text)
    .join('');
