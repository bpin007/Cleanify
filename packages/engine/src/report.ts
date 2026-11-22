/**
 * Output report (review fix 3): what is still worth telling the user about a
 * document after changes are applied: characters that are still not ASCII
 * (when the ASCII stage is on) and CSV cells that could still run as formulas.
 */
import { csvUnits, isFormulaRisk } from './formats/csv';
import { textUnits } from './formats/text';
import type { Doc, Location, OutputReport, PipelineOptions, RemainingChar } from './types';

export function checkOutput(doc: Doc, options: PipelineOptions = {}): OutputReport {
  const nonAscii: RemainingChar[] = [];
  if (options.stages?.ascii ?? false) {
    const units = doc.format === 'text' ? textUnits(doc) : csvUnits(doc);
    for (const unit of units) {
      const t = unit.text;
      for (let i = 0; i < t.length; i++) {
        const codePoint = t.codePointAt(i)!;
        if (codePoint < 0x80) continue;
        const char = String.fromCodePoint(codePoint);
        nonAscii.push({ char, codePoint, location: unit.locate(i) });
        i += char.length - 1;
      }
    }
  }

  const formulaRisks: Location[] = [];
  if (doc.format === 'csv' && (options.safety?.formulaGuard ?? true)) {
    for (const unit of csvUnits(doc))
      if (isFormulaRisk(unit.text)) formulaRisks.push(unit.locate(0));
  }
  return { nonAscii, formulaRisks };
}
