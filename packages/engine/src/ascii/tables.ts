/**
 * Stage 2 tables — PROJECT.md section 5. Plain data, so it is easy to review and to
 * extend; custom rules (Phase 3) are layered on top.
 */

export interface InvisibleInfo {
  kind: string;
  name: string;
}

/** Characters with no visible width that Stage 2 removes (section 5, section 19 #6/#7). */
const INVISIBLE_LIST: [number, string, string][] = [
  [0x00ad, 'shy', 'soft hyphen'],
  [0x034f, 'cgj', 'combining grapheme joiner'],
  [0x061c, 'direction-mark', 'Arabic letter mark'],
  [0x115f, 'filler', 'Hangul choseong filler'],
  [0x1160, 'filler', 'Hangul jungseong filler'],
  [0x17b4, 'filler', 'Khmer vowel inherent AQ'],
  [0x17b5, 'filler', 'Khmer vowel inherent AA'],
  [0x180e, 'zwsp', 'Mongolian vowel separator'],
  [0x200b, 'zwsp', 'zero-width space'],
  [0x200c, 'zwnj', 'zero-width non-joiner'],
  [0x200d, 'zwj', 'zero-width joiner'],
  [0x200e, 'direction-mark', 'left-to-right mark'],
  [0x200f, 'direction-mark', 'right-to-left mark'],
  [0x202a, 'bidi-control', 'left-to-right embedding'],
  [0x202b, 'bidi-control', 'right-to-left embedding'],
  [0x202c, 'bidi-control', 'pop directional formatting'],
  [0x202d, 'bidi-control', 'left-to-right override'],
  [0x202e, 'bidi-control', 'right-to-left override'],
  [0x2060, 'word-joiner', 'word joiner'],
  [0x2061, 'invisible-operator', 'function application'],
  [0x2062, 'invisible-operator', 'invisible times'],
  [0x2063, 'invisible-operator', 'invisible separator'],
  [0x2064, 'invisible-operator', 'invisible plus'],
  [0x2066, 'bidi-control', 'left-to-right isolate'],
  [0x2067, 'bidi-control', 'right-to-left isolate'],
  [0x2068, 'bidi-control', 'first strong isolate'],
  [0x2069, 'bidi-control', 'pop directional isolate'],
  [0x3164, 'filler', 'Hangul filler'],
  [0xffa0, 'filler', 'half-width Hangul filler'],
];

export const INVISIBLE = new Map<number, InvisibleInfo>(
  INVISIBLE_LIST.map(([cp, kind, name]) => [cp, { kind, name }]),
);

/** Space characters that become a normal space. */
export const SPACES = new Map<number, string>([
  [0x00a0, 'non-breaking space'],
  [0x1680, 'Ogham space mark'],
  [0x2000, 'en quad'],
  [0x2001, 'em quad'],
  [0x2002, 'en space'],
  [0x2003, 'em space'],
  [0x2004, 'three-per-em space'],
  [0x2005, 'four-per-em space'],
  [0x2006, 'six-per-em space'],
  [0x2007, 'figure space'],
  [0x2008, 'punctuation space'],
  [0x2009, 'thin space'],
  [0x200a, 'hair space'],
  [0x202f, 'narrow non-breaking space'],
  [0x205f, 'medium mathematical space'],
  [0x3000, 'ideographic space'],
]);

/** Punctuation → ASCII. `kind` groups them in the change list. */
export const PUNCTUATION = new Map<string, { to: string; kind: string }>([
  ...[...'‘’‚‛ʼ′´'].map((c) => [c, { to: "'", kind: 'smart-quote' }] as const),
  ...[...'“”„‟″'].map((c) => [c, { to: '"', kind: 'smart-quote' }] as const),
  ['‹', { to: '<', kind: 'smart-quote' }],
  ['›', { to: '>', kind: 'smart-quote' }],
  ...[...'‐‑‒–—―−﹘﹣'].map((c) => [c, { to: '-', kind: 'dash' }] as const),
  ['…', { to: '...', kind: 'ellipsis' }],
  [' ', { to: '\n', kind: 'line-separator' }],
  [' ', { to: '\n', kind: 'line-separator' }],
]);

/** Letters that don't decompose under NFD (section 5 "special letters"). */
// prettier-ignore
export const SPECIAL_LETTERS = new Map<string, string>([
  ['ß', 'ss'], ['ẞ', 'SS'], ['Æ', 'AE'], ['æ', 'ae'], ['Ø', 'O'], ['ø', 'o'], ['Œ', 'OE'],
  ['œ', 'oe'], ['Þ', 'Th'], ['þ', 'th'], ['Ð', 'D'], ['ð', 'd'], ['Ł', 'L'], ['ł', 'l'],
  ['Đ', 'D'], ['đ', 'd'], ['ı', 'i'], ['Ħ', 'H'], ['ħ', 'h'], ['Ŋ', 'NG'], ['ŋ', 'ng'],
  ['ĸ', 'k'], ['ſ', 's'], ['Ŧ', 'T'], ['ŧ', 't'], ['ŉ', "'n"], ['Ŀ', 'L'], ['ŀ', 'l'],
  ['Ĳ', 'IJ'], ['ĳ', 'ij'], ['ƒ', 'f'],
]);

/** Symbols → ASCII (section 5 "symbols"). Anything not listed is left as is. */
// prettier-ignore
export const SYMBOLS = new Map<string, string>([
  ['©', '(c)'], ['®', '(R)'], ['™', '(TM)'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'],
  ['¢', 'c'], ['°', 'deg'], ['×', 'x'], ['÷', '/'], ['±', '+/-'], ['•', '*'], ['·', '.'],
  ['½', '1/2'], ['¼', '1/4'], ['¾', '3/4'], ['¹', '1'], ['²', '2'], ['³', '3'], ['µ', 'u'],
  ['‰', ' per mille'], ['†', '+'], ['‡', '++'], ['§', 'S'], ['¶', 'P'], ['ª', 'a'], ['º', 'o'],
  ['¡', ''], ['¿', ''],
]);

/** Common emoji → text when emoji mode is 'text' (others are removed). */
// prettier-ignore
export const EMOJI_TEXT = new Map<string, string>([
  ['😀', ':D'], ['😃', ':D'], ['😄', ':D'], ['😁', ':D'], ['😆', 'XD'], ['🙂', ':)'],
  ['😊', ':)'], ['😉', ';)'], ['😢', ":'("], ['😭', ":'("], ['😞', ':('], ['🙁', ':('],
  ['😮', ':O'], ['😛', ':P'], ['😐', ':|'], ['❤', '<3'], ['❤️', '<3'], ['👍', '(y)'],
  ['👎', '(n)'],
]);

/** Look-alike letters (section 19 #10): Cyrillic/Greek letters that look like Latin ones. */
// prettier-ignore
export const CONFUSABLES = new Map<string, string>([
  // Cyrillic
  ['а', 'a'], ['е', 'e'], ['о', 'o'], ['р', 'p'], ['с', 'c'], ['у', 'y'], ['х', 'x'],
  ['і', 'i'], ['ј', 'j'], ['ѕ', 's'], ['ԁ', 'd'], ['һ', 'h'], ['ԛ', 'q'], ['ԝ', 'w'],
  ['А', 'A'], ['В', 'B'], ['Е', 'E'], ['К', 'K'], ['М', 'M'], ['Н', 'H'], ['О', 'O'],
  ['Р', 'P'], ['С', 'C'], ['Т', 'T'], ['Х', 'X'], ['І', 'I'], ['Ј', 'J'], ['Ѕ', 'S'],
  // Greek
  ['ο', 'o'], ['ν', 'v'], ['α', 'a'], ['ι', 'i'], ['κ', 'k'], ['ρ', 'p'], ['τ', 't'],
  ['υ', 'u'], ['Α', 'A'], ['Β', 'B'], ['Ε', 'E'], ['Ζ', 'Z'], ['Η', 'H'], ['Ι', 'I'],
  ['Κ', 'K'], ['Μ', 'M'], ['Ν', 'N'], ['Ο', 'O'], ['Ρ', 'P'], ['Τ', 'T'], ['Υ', 'Y'],
  ['Χ', 'X'],
]);
