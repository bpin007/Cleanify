/**
 * "Must not change" corpus — PROJECT.md section 20 and section 19 #11.
 * Valid text in many languages: Stage 1 must propose ZERO changes.
 */
import { describe, expect, it } from 'vitest';
import { analyze, parseText } from '../src/index';
import { byStage, readCorpus } from './helpers';

const corpus = readCorpus();

describe('must not change: Stage 1 leaves valid text alone', () => {
  it('has the seven required languages plus tricky cases', () => {
    expect(corpus.map((c) => c.name)).toEqual([
      'ar.txt',
      'de.txt',
      'es.txt',
      'fr.txt',
      'pl.txt',
      'tr.txt',
      'tricky.txt',
      'zh.txt',
    ]);
  });

  it.each(corpus)('$name: zero encoding changes for the whole file', ({ text }) => {
    const { changes } = analyze(parseText(text), { stages: { encoding: true, ascii: false } });
    expect(byStage(changes, 'encoding')).toEqual([]);
  });

  it.each(corpus)('$name: zero encoding changes line by line', ({ text }) => {
    for (const line of text.split('\n').filter(Boolean)) {
      const { changes } = analyze(parseText(line), { stages: { encoding: true, ascii: false } });
      expect(byStage(changes, 'encoding'), line).toEqual([]);
    }
  });
});
