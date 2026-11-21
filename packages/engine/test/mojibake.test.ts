/**
 * Stage 1 mojibake repair, tested at function level (findMojibake).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findMojibake } from '../src/mojibake/repair';
import { CP1252_SPECIALS, mojibake, readCorpus } from './helpers';

function fix(text: string): string {
  let out = '';
  let pos = 0;
  for (const p of findMojibake(text)) {
    out += text.slice(pos, p.start) + p.to;
    pos = p.end;
  }
  return out + text.slice(pos);
}

describe('findMojibake — repairs', () => {
  it.each([
    ['CafÃ©', 'Café'],
    ['donâ€™t', 'don’t'],
    ['JosÃ© GarcÃ­a', 'José García'],
    ['â€œquoteâ€\u009D', '“quote”'],
    ['Ã\u0081lvaro', 'Álvaro'],
  ])('%s → %s', (input, expected) => {
    expect(fix(input)).toBe(expected);
  });

  it.each([
    ['Polish', 'Zażółć gęślą jaźń'],
    ['Czech', 'Příliš žluťoučký kůň'],
    ['Turkish', 'Iğdır ışık şeker'],
    ['Romanian', 'Știință și țară'],
    ['Greek', 'Αθήνα Ελληνικά'],
    ['Russian', 'Москва, привет'],
    ['Chinese', '中文测试'],
    ['Japanese', 'こんにちは世界'],
    ['Korean', '안녕하세요'],
    ['Arabic', 'مرحبا بكم'],
    ['Hebrew', 'שלום עולם'],
    ['emoji', 'ok 😀 👍 🇫🇷'],
    ['symbols', '€ ™ → − • …'],
  ])('repairs garbled %s', (_lang, original) => {
    expect(fix(mojibake(original))).toBe(original);
  });

  it('repairs double and triple garbling in one change', () => {
    const twice = mojibake(mojibake('é'));
    expect(twice).toBe('ÃƒÂ©');
    const [p] = findMojibake(twice);
    expect(p).toMatchObject({ from: 'ÃƒÂ©', to: 'é' });
    expect(p?.reason).toMatch(/twice/);

    const thrice = mojibake(mojibake(mojibake('Café “ok”')));
    expect(fix(thrice)).toBe('Café “ok”');
    expect(findMojibake(thrice).some((q) => /three times/.test(q.reason))).toBe(true);
  });

  it('repairs decomposed accents after an ASCII letter', () => {
    expect(fix(mojibake('Café'))).toBe('Café');
  });

  it('marks repairs that rely on the surrounding text as medium confidence', () => {
    // A single garbled Greek letter is only trusted because Greek appears elsewhere.
    const [p] = findMojibake(`Αθήνα ${mojibake('λ')}`);
    expect(p).toMatchObject({ to: 'λ', confidence: 'medium' });
    expect(findMojibake('CafÃ©')[0]?.confidence).toBe('high');
  });
});

describe('findMojibake — must not change', () => {
  it.each([
    '«CAFÉ»',
    'CAFÉ…',
    'MÜ»',
    'SÍ…',
    'IRMÃO',
    'É»',
    'naïve Müller São Paulo',
    'ÀÉÎÕÜ',
    'Ångström',
  ])('leaves %s alone', (s) => {
    expect(findMojibake(s)).toEqual([]);
  });

  it('does not repair a single garbled non-Latin letter with no corroboration', () => {
    // "Ï…" could be Greek υ, but nothing else in the text is Greek.
    expect(findMojibake('HAÏ… said hi')).toEqual([]);
  });

  it.each(readCorpus())('$name: no proposals', ({ text }) => {
    expect(findMojibake(text)).toEqual([]);
  });

  it.each(CP1252_SPECIALS)('repairs garbled %s', (ch) => {
    expect(fix(mojibake(`a${ch}b`))).toBe(`a${ch}b`);
  });
});

describe('findMojibake — properties', () => {
  // Characters a real document could contain and a repair should restore exactly.
  const plausibleChar = fc.oneof(
    fc.constantFrom(...'abcxyzABC 0123,.;:!?()-\n'),
    fc.constantFrom(...'éèêëàâäçñöüßÉÀÇÑÖÜåøæœąćęłńóśźżčďěňřšťůžğışİ'),
    fc.constantFrom(...CP1252_SPECIALS, '©', '®', '°', '±', '«', '»', '¿', '¡'),
    fc.constantFrom('😀', '👍', '🎉', '→', '−', '™', '…'),
  );
  const plausibleText = fc.array(plausibleChar, { maxLength: 40 }).map((a) => a.join(''));

  it('repair(mojibake(text)) === text for plausible text that is not itself garbled', () => {
    // Text like "â€€" is already valid mojibake (of U+2000); repairing it further is
    // correct behaviour, so the property only covers text Stage 1 considers clean.
    const clean = plausibleText.filter((t) => findMojibake(t).length === 0);
    fc.assert(
      fc.property(clean, (t) => fix(mojibake(t)) === t),
      { numRuns: 1000 },
    );
  });

  it('never changes text that is pure ASCII', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...' abcXYZ019.,;\n\t"\'') }),
        (t) => findMojibake(t).length === 0,
      ),
    );
  });

  it('proposals never overlap and are in order', () => {
    fc.assert(
      fc.property(plausibleText, (t) => {
        const ps = findMojibake(mojibake(t));
        return ps.every((p, i) => p.start < p.end && (i === 0 || ps[i - 1]!.end <= p.start));
      }),
    );
  });
});
