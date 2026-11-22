/**
 * Text adapter: locations, apply, render, serialize (end to end from bytes).
 */
import { describe, expect, it } from 'vitest';
import { codePointsBetween, textLocator } from '../src/formats/text';
import { analyze, applyChanges, decode, parseText, render, serialize } from '../src/index';
import { bytes, mojibake, utf8 } from './helpers';

describe('text locations', () => {
  const locate = textLocator('ab\r\n😀é\nlast');

  it('counts lines on LF and columns in code points', () => {
    expect(locate(0)).toEqual({ type: 'text', line: 1, column: 1, offset: 0 });
    expect(locate(4)).toEqual({ type: 'text', line: 2, column: 1, offset: 4 });
    expect(locate(6)).toEqual({ type: 'text', line: 2, column: 2, offset: 6 }); // after 😀
    expect(locate(8)).toEqual({ type: 'text', line: 3, column: 1, offset: 8 });
    expect(locate(12)).toEqual({ type: 'text', line: 3, column: 5, offset: 12 });
  });

  it('counts a surrogate pair once', () => {
    expect(codePointsBetween('😀😀a', 0, 5)).toBe(3);
  });
});

describe('text documents end to end', () => {
  it('bytes → decode → analyze → apply → serialize', () => {
    const original = 'José says “it’s café time” — ok…\n';
    const input = utf8(mojibake(original));
    const d = decode(input);
    const doc = parseText(d.text);

    const stage1 = analyze(doc);
    expect(render(applyChanges(doc, stage1.changes))).toBe(original);
    expect(stage1.warnings).toContainEqual(
      expect.objectContaining({ kind: 'whole-file-mojibake' }),
    );

    const both = analyze(doc, { stages: { encoding: true, ascii: true } });
    const out = serialize(applyChanges(doc, both.changes), { encoding: 'utf-8' });
    expect(new TextDecoder().decode(out)).toBe('Jose says "it\'s cafe time" - ok...\n');
  });

  it('keeps line endings and an untouched text byte-identical', () => {
    const input = bytes([0xef, 0xbb, 0xbf], 'a\r\nb\rc\n');
    const d = decode(input);
    const doc = parseText(d.text);
    expect(analyze(doc).changes).toEqual([]);
    const out = serialize(applyChanges(doc, []), { encoding: d.encoding, bomCount: d.bomCount });
    expect(Buffer.from(out).equals(Buffer.from(input))).toBe(true);
  });

  it('Stage 1 can be switched off', () => {
    expect(analyze(parseText('CafÃ©'), { stages: { encoding: false } }).changes).toEqual([]);
  });

  it('serializes to UTF-8 without a BOM by default', () => {
    expect([...serialize(parseText('é'))]).toEqual([0xc3, 0xa9]);
  });
});
