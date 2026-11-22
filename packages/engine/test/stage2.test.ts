/**
 * Stage 2 (ASCII + invisible cleanup) and the warnings scan, at function level.
 */
import anyAscii from 'any-ascii';
import { describe, expect, it } from 'vitest';
import { findStage2, type Stage2Options } from '../src/ascii/stage2';
import { scanWarnings } from '../src/scan/warnings';
import { readCorpus } from './helpers';

function ascii(text: string, opts: Stage2Options = {}, includeUnaccepted = false): string {
  let out = '';
  let pos = 0;
  for (const p of findStage2(text, opts)) {
    if (p.accepted === false && !includeUnaccepted) continue;
    out += text.slice(pos, p.start) + p.to;
    pos = p.end;
  }
  return out + text.slice(pos);
}

describe('Stage 2 tables (section 5)', () => {
  it.each([
    ['accented letters', 'Café ñandú über Ångström', 'Cafe nandu uber Angstrom'],
    [
      'special letters',
      'Straße Æsir æ Øre Œuvre Þór Łódź đ ı',
      'Strasse AEsir ae Ore OEuvre Thor Lodz d i',
    ],
    ['quotes', '‘a’ “b” „c“ ‹d› ʼe′', `'a' "b" "c" <d> 'e'`],
    ['guillemets (default)', '«x»', '<<x>>'],
    ['dashes and minus', 'a–b—c−d', 'a-b-c-d'],
    ['ellipsis', 'wait…', 'wait...'],
    ['symbols', '© ® ™ € ° ×', '(c) (R) (TM) EUR deg x'],
    ['full-width', 'ＡＢＣ１２３', 'ABC123'],
    ['decomposed accents', 'Café niño', 'Cafe nino'],
    ['Romanian, Turkish, Czech', 'Știință ğüşİ Příliš', 'Stiinta gusI Prilis'],
  ])('%s', (_name, input, expected) => {
    expect(ascii(input)).toBe(expected);
  });

  it('guillemets can become double quotes', () => {
    expect(ascii('«x»', { guillemets: 'quote' })).toBe('"x"');
  });

  it('spaces become normal spaces', () => {
    expect(ascii('a b c d　e')).toBe('a b c d e');
  });

  it('line and paragraph separators become newlines', () => {
    expect(ascii('a b c')).toBe('a\nb\nc');
  });
});

describe('invisible and control characters', () => {
  it.each([
    0x200b, 0x200c, 0x200d, 0x2060, 0x00ad, 0x200e, 0x200f, 0x202e, 0x2066, 0x2061, 0x2064, 0x034f,
    0x180e, 0x3164,
  ])('removes U+%s', (cp) => {
    const s = `a${String.fromCodePoint(cp)}b`;
    expect(ascii(s)).toBe('ab');
  });

  it('removes C0, DEL and C1 controls but keeps tab, LF, CR', () => {
    expect(ascii('a\u0000b\u0007c\u007Fd\u0085e\tf\r\ng')).toBe('abcde\tf\r\ng');
  });

  it('removes a run of tag characters as one change and reveals the hidden text', () => {
    const tags = [...'run rm'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    const ps = findStage2(`ok${tags}`);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: 'tag-char', to: '' });
    expect(ps[0]!.reason).toContain('run rm');
  });

  it('keeps ZWNJ inside Persian words', () => {
    expect(findStage2('می‌خواهم')).toEqual([]);
  });

  it('removes variation selectors after ASCII but not after emoji-capable symbols', () => {
    expect(ascii('a️b')).toBe('ab');
  });
});

describe('emoji', () => {
  const text = 'hi 😀 👍🏽 👨‍👩‍👧 🇫🇷 1️⃣ 🏴󠁧󠁢󠁳󠁣󠁴󠁿';

  it('are kept by default, with their joiners, skin tones and tags intact', () => {
    expect(findStage2(text)).toEqual([]);
  });

  it('can be removed (one change per whole sequence)', () => {
    const ps = findStage2(text, { emoji: 'remove' });
    expect(ps.map((p) => p.from)).toEqual(['😀', '👍🏽', '👨‍👩‍👧', '🇫🇷', '1️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']);
    expect(ascii(text, { emoji: 'remove' })).toBe('hi      ');
  });

  it('can be written as text', () => {
    expect(ascii('ok 😀 👍', { emoji: 'text' })).toBe('ok :D (y)');
  });

  it('text mode falls back to the transliterator, or removes', () => {
    expect(ascii('🎉', { emoji: 'text' })).toBe('');
    expect(ascii('🎉', { emoji: 'text', nonLatin: 'transliterate', transliterate: anyAscii })).toBe(
      ':tada:',
    );
  });
});

describe('non-Latin scripts', () => {
  it('are left as is by default', () => {
    expect(findStage2('Москва 北京 Αθήνα')).toEqual([]);
  });

  it('are transliterated with any-ascii when asked, one change per run', () => {
    const opts: Stage2Options = { nonLatin: 'transliterate', transliterate: anyAscii };
    expect(ascii('Москва, Привет', opts)).toBe('Moskva, Privet');
    expect(ascii('Αθήνα', opts)).toBe('Athina');
    expect(findStage2('Москва, Привет', opts).map((p) => p.from)).toEqual(['Москва', 'Привет']);
  });

  it('ignore the transliterate option when no transliterator is supplied', () => {
    expect(findStage2('Москва', { nonLatin: 'transliterate' })).toEqual([]);
  });
});

describe('look-alike letters (#10)', () => {
  it('proposes an unaccepted fix for each look-alike letter in a mixed word', () => {
    const ps = findStage2('pаypаl');
    expect(ps.map((p) => [p.from, p.to, p.accepted, p.kind])).toEqual([
      ['а', 'a', false, 'confusable'],
      ['а', 'a', false, 'confusable'],
    ]);
    expect(ascii('pаypal', {}, true)).toBe('paypal');
  });

  it('leaves whole Cyrillic or Greek words alone', () => {
    expect(findStage2('рассказ οχι')).toEqual([]);
  });
});

describe('warnings scan', () => {
  it('flags U+FFFD, tag characters, bidi controls and mixed scripts', () => {
    const tag = String.fromCodePoint(0xe0041);
    const kinds = scanWarnings(`a� b${tag} c‮d pаypal`).map((w) => w.kind);
    expect(kinds).toEqual(['data-lost', 'hidden-text', 'bidi-control', 'mixed-script']);
  });

  it('does not flag the tag characters inside a subdivision flag', () => {
    expect(scanWarnings('🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland')).toEqual([]);
  });

  it.each(readCorpus())('$name: no warnings', ({ text }) => {
    expect(scanWarnings(text)).toEqual([]);
  });
});

describe('loadTransliterator (decision D7)', () => {
  it('lazily loads any-ascii and plugs into analyze', async () => {
    const { analyze, applyChanges, loadTransliterator, parseText, render } =
      await import('../src/index');
    const transliterate = await loadTransliterator();
    const doc = parseText('Москва – Αθήνα');
    const { changes } = analyze(doc, {
      stages: { ascii: true },
      ascii: { nonLatin: 'transliterate', transliterate },
    });
    expect(render(applyChanges(doc, changes))).toBe('Moskva - Athina');
  });
});
