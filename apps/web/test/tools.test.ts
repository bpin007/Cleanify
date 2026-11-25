/** The tool pages' examples must be what the tool really does. */
import { describe, expect, it } from 'vitest';
import { EngineSession } from '@cleanify/session';
import { TOOLS } from '../src/pages/tools';
import { DEFAULT_SETTINGS } from '../src/session/defaults';

describe('tool pages', () => {
  it.each(TOOLS.filter((t) => t.example).map((t) => [t.slug, t] as const))(
    '%s: the example on the page is what the engine produces',
    async (_slug, tool) => {
      const s = new EngineSession();
      await s.analyze(
        { kind: 'paste', text: tool.example!.before },
        { ...DEFAULT_SETTINGS, ...tool.preset },
        () => {},
      );
      expect(s.outputText()).toBe(tool.example!.after);
    },
  );

  it('have unique slugs and the six tools from the site map', () => {
    expect(TOOLS.map((t) => t.slug)).toEqual([
      'fix-garbled-text',
      'remove-accents',
      'remove-invisible-characters',
      'translate-to-english',
      'csv-cleaner',
      'excel-cleaner',
    ]);
  });

  it('remove-invisible-characters changes invisible characters only, with no ASCII report', async () => {
    const tool = TOOLS.find((t) => t.slug === 'remove-invisible-characters')!;
    const s = new EngineSession();
    const data = await s.analyze(
      { kind: 'paste', text: 'Café au​lait' },
      { ...DEFAULT_SETTINGS, ...tool.preset },
      () => {},
    );
    expect(new Set(data.changes.map((c) => c.stage))).toEqual(new Set(['invisible']));
    expect(data.nonAscii).toEqual([]);
    expect(s.outputText()).toBe('Café aulait');
  });
});
