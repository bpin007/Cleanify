import type { Confidence, Severity, Stage, WarningKind } from './types';

/**
 * A change found by one stage inside one piece of text, before the pipeline turns
 * it into a `Change` with an id, an anchor and a location.
 */
export interface Proposal {
  /** UTF-16 offsets in the text the stage looked at. */
  start: number;
  end: number;
  from: string;
  to: string;
  stage: Stage;
  kind: string;
  reason: string;
  confidence: Confidence;
  /** Default: accepted when confidence is high. */
  accepted?: boolean;
}

export type FoundWarning = {
  kind: WarningKind;
  severity: Severity;
  message: string;
  /** UTF-16 offset in the text that was scanned. */
  offset: number;
};
