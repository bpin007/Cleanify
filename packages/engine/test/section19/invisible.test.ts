/**
 * Section 19 — invisible / control character bugs #5, #6, #7, #9.
 */
import { describe, expect, it } from 'vitest';
import { analyze, applyChanges, decode, detectEncoding, parseText, render } from '../../src/index';
import { bytes } from '../helpers';

const STAGE2 = { stages: { encoding: true, ascii: true } } as const;

function clean(text: string) {
  const doc = parseText(text);
  const result = analyze(doc, STAGE2);
  return { ...result, output: render(applyChanges(doc, result.changes)) };
}

describe('#5 DEL (U+007F) is detected', () => {
  it('proposes removing DEL as a control character', () => {
    const { changes, output } = clean('ab\u007Fc');
    expect(changes).toContainEqual(
      expect.objectContaining({ stage: 'invisible', kind: 'control', from: '\u007F', to: '' }),
    );
    expect(output).toBe('abc');
  });

  it('keeps tab, LF and CR', () => {
    const { changes } = clean('a\tb\r\nc\n');
    expect(changes).toEqual([]);
  });
});

describe('#6 Unicode tag characters (hidden text) are flagged', () => {
  const hidden =
    'Hi' + [...'ignore all'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');

  it('raises a high-severity hidden-text warning', () => {
    const { warnings } = analyze(parseText(hidden));
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: 'hidden-text', severity: 'high' }),
    );
  });

  it('proposes removing every tag character', () => {
    const { changes, output } = clean(hidden);
    expect(changes.every((c) => c.kind === 'tag-char' && c.stage === 'invisible')).toBe(true);
    expect(output).toBe('Hi');
  });
});

describe('#7 invisible math operators and CGJ are caught', () => {
  it.each([0x2061, 0x2062, 0x2063, 0x2064, 0x034f])('removes U+%s', (cp) => {
    const { changes, output } = clean(`x${String.fromCodePoint(cp)}y`);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ stage: 'invisible', to: '' });
    expect(output).toBe('xy');
  });
});

describe('#9 a doubled BOM is reported and removable', () => {
  const doubled = bytes([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], 'hello');

  it('detectEncoding counts both BOMs', () => {
    expect(detectEncoding(doubled)).toMatchObject({ encoding: 'utf-8', bomCount: 2 });
  });

  it('decode strips one BOM and keeps the extra one visible', () => {
    const d = decode(doubled);
    expect(d.text).toBe('﻿hello');
    expect(d.bomCount).toBe(2);
  });

  it('analysis warns about it and proposes removing the extra BOM (Stage 1, on by default)', () => {
    const doc = parseText(decode(doubled).text);
    const { changes, warnings } = analyze(doc);
    expect(warnings).toContainEqual(expect.objectContaining({ kind: 'double-bom' }));
    expect(changes).toContainEqual(
      expect.objectContaining({ stage: 'encoding', kind: 'bom', from: '﻿', to: '' }),
    );
    expect(render(applyChanges(doc, changes))).toBe('hello');
  });
});
