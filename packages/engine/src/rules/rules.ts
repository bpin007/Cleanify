/**
 * Custom rules (PROJECT.md section 5): finding where replace rules match and which text
 * keep rules protect. Plain text only, exact and case-sensitive (no patterns in v1).
 */
import type { KeepRule, ReplaceRule } from '../types';

export interface RuleMatch {
  /** UTF-16 offsets in the text that was searched. */
  start: number;
  end: number;
  rule: ReplaceRule;
}

export type Range = readonly [start: number, end: number];

/**
 * Every place a replace rule matches, earliest rule first: a match that overlaps one
 * already taken (by an earlier rule, or earlier in the text) is dropped. All rules
 * search the same text, so no rule sees another rule's output. Sorted by position.
 */
export function findRuleMatches(text: string, rules: readonly ReplaceRule[]): RuleMatch[] {
  const taken: RuleMatch[] = [];
  for (const rule of rules) {
    if (rule.from === '') continue;
    for (let i = text.indexOf(rule.from); i >= 0; i = text.indexOf(rule.from, i + 1)) {
      const end = i + rule.from.length;
      if (taken.some((m) => i < m.end && m.start < end)) continue;
      taken.push({ start: i, end, rule });
      i = end - 1; // occurrences of one rule never overlap each other
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** The ranges of `text` that keep rules protect, sorted. */
export function keptRanges(text: string, keep: readonly KeepRule[]): Range[] {
  const out: Range[] = [];
  for (const { text: kept } of keep) {
    if (kept === '') continue;
    for (let i = text.indexOf(kept); i >= 0; i = text.indexOf(kept, i + 1))
      out.push([i, i + kept.length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Does [start, end) overlap any of the ranges? (An empty range overlaps none.) */
export function overlapsAny(ranges: readonly Range[], start: number, end: number): boolean {
  return ranges.some(([s, e]) => start < e && s < end);
}
