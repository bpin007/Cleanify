/**
 * Section 19 — #3 (Excel) and #4 (Access).
 *
 * PROJECT.md section 23 puts the Excel and Access adapters in Phase 2, so these
 * are placeholders that show up in every test run as "todo" until then.
 */
import { describe, it } from 'vitest';

describe('#3 Excel cleaning keeps formulas (Phase 2)', () => {
  it.todo('.xlsx round-trip keeps formulas, number formats, dates and styles (ExcelJS)');
  it.todo('only string cells (incl. rich-text runs) are edited');
  it.todo('charts and pivot tables are detected on load and warned about');
  it.todo('.xls/.ods (SheetJS read-only) export warns that styles are not kept');
});

describe('#4 Access export keeps column names and types (Phase 2)', () => {
  it.todo('real column names become the header row');
  it.todo('number and date columns stay numbers and dates in the .xlsx');
});
