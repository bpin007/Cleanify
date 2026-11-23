/**
 * Section 19 — #3 (Excel keeps formulas) and #4 (Access keeps column names and types).
 *
 * The fixtures in test/fixtures/office were made with real Excel 2010 and Access 2010
 * (scripts next to them), so these tests read what users will actually upload.
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  applyChanges,
  readWorkbook,
  writeWorkbook,
  type SheetDoc,
  type SheetSource,
} from '../../src/index';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'office');
const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const load = (name: string, source: SheetSource) => readWorkbook(fixture(name), source);

async function cleanAndReopen(doc: SheetDoc, options = {}) {
  const { changes } = analyze(doc, options);
  const out = applyChanges(doc, changes, options);
  const bytes = await writeWorkbook(out as SheetDoc);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return { wb, changes, out: out as SheetDoc };
}

const value = (wb: ExcelJS.Workbook, sheet: string, address: string) =>
  wb.getWorksheet(sheet)!.getCell(address).value;

describe('#3 Excel cleaning keeps formulas', () => {
  it('.xlsx round-trip keeps formulas, number formats, dates and styles (ExcelJS)', async () => {
    const doc = await load('formulas.xlsx', 'xlsx');
    const { wb } = await cleanAndReopen(doc);
    const ws = wb.getWorksheet('Data')!;
    expect(ws.getCell('A2').value).toBe('café');
    expect(ws.getCell('A3').value).toBe('don’t');
    expect(ws.getCell('B2').value).toBe(1234.5);
    expect(ws.getCell('B2').numFmt).toBe('#,##0.00');
    expect(ws.getCell('B3').value).toBe(-42);
    expect(ws.getCell('C2').value).toEqual(new Date('2024-03-15T00:00:00.000Z'));
    expect(ws.getCell('B4').value).toMatchObject({ formula: 'SUM(B2:B3)' });
    expect(ws.getCell('D4').value).toMatchObject({ formula: 'A2&"!"' });
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A1').fill).toMatchObject({ type: 'pattern' });
    expect(ws.getCell('A7').isMerged).toBe(true);
    expect(ws.getCell('B7').master.address).toBe('A7');
    expect(ws.getColumn(1).width).toBeCloseTo(24.71, 1);
    expect(value(wb, 'Notes ü', 'A1')).toBe('Grün');
    expect(value(wb, 'Notes ü', 'B1')).toBe(7);
  });

  it('only string cells (incl. rich-text runs) are edited', async () => {
    const doc = await load('formulas.xlsx', 'xlsx');
    const addresses = doc.cells.map((c) => `${c.sheet}!${c.address}`);
    // Text, rich text, hyperlink text and a merged range's top-left cell; no numbers,
    // dates, formulas or merged-away cells.
    expect(addresses).toEqual([
      'Data!A1',
      'Data!B1',
      'Data!C1',
      'Data!D1',
      'Data!A2',
      'Data!D2',
      'Data!A3',
      'Data!D3',
      'Data!A4',
      'Data!A5',
      'Data!D5',
      'Data!A7',
      'Data!A8',
      'Notes ü!A1',
    ]);
    const { wb } = await cleanAndReopen(doc);
    const rich = value(wb, 'Data', 'D5') as ExcelJS.CellRichTextValue;
    expect(rich.richText.map((r) => r.text)).toEqual(['Bold', ' café']);
    const original = (
      await new ExcelJS.Workbook().xlsx.load(fixture('formulas.xlsx') as unknown as ArrayBuffer)
    )
      .getWorksheet('Data')!
      .getCell('D5').value as ExcelJS.CellRichTextValue;
    expect(rich.richText.map((r) => r.font)).toEqual(original.richText.map((r) => r.font));
    expect(value(wb, 'Data', 'A8')).toEqual({
      text: 'Visit café',
      hyperlink: 'https://example.com/',
    });
    // Text that looks like a formula is text in .xlsx and is never run, so no guard.
    expect(value(wb, 'Data', 'A5')).toBe('=1+1');
  });

  it('every change points at a sheet and cell', async () => {
    const doc = await load('formulas.xlsx', 'xlsx');
    const { changes } = analyze(doc);
    const a2 = changes.find((c) => c.from === 'Ã©' && c.location.type === 'sheet');
    expect(a2?.location).toEqual({ type: 'sheet', sheet: 'Data', cell: 'A2', charPos: 4 });
    expect(changes.every((c) => c.stage !== 'safety')).toBe(true);
  });

  it('charts and pivot tables are detected on load and warned about', async () => {
    const doc = await load('chart-pivot.xlsx', 'xlsx');
    const w = doc.warnings.find((x) => x.kind === 'export-drops-parts');
    expect(w?.severity).toBe('high');
    expect(w?.message).toContain('charts and pivot tables');
    const plain = await load('formulas.xlsx', 'xlsx');
    expect(plain.warnings.some((x) => x.kind === 'export-drops-parts')).toBe(false);
  });

  it.each([
    ['legacy.xls', 'xls'],
    ['legacy.ods', 'ods'],
  ] as const)(
    '%s (SheetJS read-only) export warns that styles are not kept, keeps values and formulas',
    async (name, source) => {
      const doc = await load(name, source);
      expect(doc.warnings.find((w) => w.kind === 'styles-not-kept')?.message).toContain(
        'not its styles',
      );
      const { wb } = await cleanAndReopen(doc);
      const ws = wb.getWorksheet('Data')!;
      expect(ws.getCell('A2').value).toBe('café');
      expect(ws.getCell('B2').value).toBe(1234.5);
      expect(ws.getCell('B2').numFmt).toBe('#,##0.00');
      expect(ws.getCell('C2').value).toBeInstanceOf(Date);
      expect((ws.getCell('C2').value as Date).toISOString().slice(0, 10)).toBe('2024-03-15');
      expect(ws.getCell('B4').value).toMatchObject({ formula: 'SUM(B2:B3)' });
      expect(ws.getCell('A7').isMerged).toBe(true);
      // Excel's .ods writer turns the space in "Notes ü" into "_".
      expect(value(wb, doc.sheets[1]!, 'A1')).toBe('Grün');
    },
  );
});

describe('#4 Access export keeps column names and types', () => {
  it.each([
    ['customers.accdb', 'accdb'],
    ['customers.mdb', 'mdb'],
  ] as const)('%s: real column names become the header row', async (name, source) => {
    const doc = await load(name, source);
    expect(doc.sheets).toEqual(['Customers', 'Order Lines']);
    const { wb } = await cleanAndReopen(doc);
    const ws = wb.getWorksheet('Customers')!;
    expect(ws.getRow(1).values).toEqual([
      undefined,
      'ID',
      'CustomerName',
      'City',
      'Joined',
      'Balance',
      'Visits',
      'Score',
      'Active',
      'Notes',
    ]);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(doc.warnings.find((w) => w.kind === 'skipped-data')?.message).toContain(
      'Customers.Photo',
    );
    expect(doc.warnings.some((w) => w.kind === 'converted')).toBe(true);
  });

  it.each([
    ['customers.accdb', 'accdb'],
    ['customers.mdb', 'mdb'],
  ] as const)('%s: number and date columns stay numbers and dates', async (name, source) => {
    const doc = await load(name, source);
    const { wb } = await cleanAndReopen(doc);
    const ws = wb.getWorksheet('Customers')!;
    const row = (n: number) => ws.getRow(n);
    expect(row(2).getCell(1).value).toBe(1);
    expect(row(2).getCell(2).value).toBe('Café Lumière');
    expect(row(2).getCell(4).value).toBeInstanceOf(Date);
    expect((row(2).getCell(4).value as Date).toISOString().slice(0, 10)).toBe('2024-03-15');
    expect(row(2).getCell(5).value).toBe(1234.5);
    expect(row(2).getCell(6).value).toBe(3);
    expect(row(2).getCell(7).value).toBe(4.25);
    expect(row(2).getCell(8).value).toBe(true);
    expect(row(2).getCell(9).value).toBe('don’t forget');
    expect(row(3).getCell(2).value).toBe('Zoë Müller');
    expect(row(3).getCell(3).value).toBe('Москва');
    expect(row(3).getCell(5).value).toBe(-42);
    expect(row(3).getCell(8).value).toBe(false);
    expect(row(4).getCell(9).value).toBeNull();
    expect(value(wb, 'Order Lines', 'B2')).toBe('Crème');
  });
});
