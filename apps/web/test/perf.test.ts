/**
 * Size check: a 20,000-row CSV with ~6 changes per row must stay usable. Guards
 * against accidental quadratic work in the worker session or the row builder.
 */
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../src/engine/session';
import { buildRows } from '../src/lib/rows';

const ROWS = 20_000;
const csv = ['id,text'];
for (let i = 1; i <= ROWS; i++) csv.push(`${i},"Row ${i} cafÃ© â€œquotedâ€ naïve"`);
const bytes = new TextEncoder().encode(csv.join('\n') + '\n').buffer as ArrayBuffer;

describe('large input', () => {
  it('analyzes, decides and builds rows for 20,000 rows in reasonable time', async () => {
    const s = new EngineSession();
    const t0 = performance.now();
    const data = await s.analyze(
      { kind: 'file', name: 'big.csv', format: 'csv', bytes },
      {
        repair: true,
        ascii: true,
        asciiScope: 'all',
        asciiOptions: { emoji: 'keep', nonLatin: 'keep' },
      },
      () => {},
    );
    const t1 = performance.now();
    const rows = buildRows(data.original, data.marks, data.edits);
    const t2 = performance.now();
    s.decide([{ type: 'group', stage: 'encoding', accepted: false }]);
    const t3 = performance.now();
    console.log(
      `changes ${data.changes.length}: analyze ${Math.round(t1 - t0)} ms, rows ${Math.round(t2 - t1)} ms, decide ${Math.round(t3 - t2)} ms`,
    );
    expect(rows).toHaveLength(ROWS + 1);
    expect(t1 - t0).toBeLessThan(15_000);
    expect(t2 - t1).toBeLessThan(3_000);
    expect(t3 - t2).toBeLessThan(10_000);
  }, 60_000);
});
