/**
 * "Must not change" corpus — PROJECT.md section 20 and section 19 #11.
 * Valid text in many languages: Stage 1 must propose ZERO changes.
 */
import { describe, expect, it } from 'vitest';
import { analyze, applyChanges, parseText, render } from '../src/index';
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

describe('must not change: real German text containing Ä… (review fix 2)', () => {
  const lines = [
    'Wörter mit Ä… gibt es viele: Ärger, Äpfel, Ähre.',
    'Liste der Umlaute: Ä… Ö… Ü… und ß.',
    'Kapitel Ä…, dann Kapitel Ö.',
  ];
  it.each(lines)('%s: applying the default decisions leaves it unchanged', (line) => {
    const doc = parseText(line);
    const { changes } = analyze(doc);
    expect(render(applyChanges(doc, changes))).toBe(line);
    for (const c of changes) expect(c).toMatchObject({ confidence: 'medium', accepted: false });
  });
});
