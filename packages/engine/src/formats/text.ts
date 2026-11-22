/**
 * Text adapter: the whole text is one unit. Locations are 1-based line and
 * column, with columns counted in code points (section 19 #15).
 */
import { applyToUnit } from '../changes/apply';
import type { PipelineUnit } from '../pipeline/analyze';
import type { Change, Location, TextDoc } from '../types';

export const TEXT_UNIT = 'text';

export function parseText(text: string): TextDoc {
  return { format: 'text', text };
}

/** Code points in text[from, to). */
export function codePointsBetween(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    // Count a surrogate pair once (skip the low half).
    if (!(c >= 0xdc00 && c <= 0xdfff && i > from && isHigh(text.charCodeAt(i - 1)))) n++;
  }
  return n;
}
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

export function textLocator(text: string): (offset: number) => Location {
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    const start = lineStarts[lo]!;
    return {
      type: 'text',
      line: lo + 1,
      column: codePointsBetween(text, start, offset) + 1,
      offset,
    };
  };
}

export function textUnits(doc: TextDoc): PipelineUnit[] {
  return [{ id: TEXT_UNIT, text: doc.text, locate: textLocator(doc.text) }];
}

export function applyText(doc: TextDoc, changes: readonly Change[]): TextDoc {
  return parseText(applyToUnit(TEXT_UNIT, doc.text, changes));
}
