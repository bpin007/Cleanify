/**
 * Workbook adapter details: rich-text runs, zip scanning, formula names, preview.
 * (Round-trips of real Excel/Access files are in section19/office.test.ts.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cellRef, distributeRuns, renderSheet } from '../src/formats/sheet';
import { excelFormula, sheetNameFor } from '../src/formats/workbook';
import { partsDroppedOnExport, zipEntryNames } from '../src/formats/zip';
import {
  analyze,
  applyChanges,
  checkOutput,
  preview,
  readWorkbook,
  render,
  serialize,
  sheetSourceOf,
  type SheetDoc,
} from '../src/index';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'office');
const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

const edit = (start: number, end: number, output: string) => ({ start, end, output });

describe('distributeRuns', () => {
  it('keeps unchanged characters in their run and puts each edit in the run it starts in', () => {
    expect(distributeRuns(['Bold', ' cafÃ©'], [edit(8, 10, 'é')])).toEqual(['Bold', ' café']);
    expect(distributeRuns(['ab', 'cd'], [edit(1, 3, 'X')])).toEqual(['aX', 'd']);
    expect(distributeRuns(['ab', 'cd'], [edit(2, 2, '+')])).toEqual(['ab', '+cd']);
    expect(distributeRuns(['ab', 'cd'], [edit(4, 4, '!')])).toEqual(['ab', 'cd!']);
    expect(distributeRuns(['ab', '', 'cd'], [edit(0, 4, '')])).toEqual(['', '', '']);
  });
});

describe('zip scanning', () => {
  it('lists entries of a real .xlsx and finds the parts ExcelJS drops', () => {
    const names = zipEntryNames(fixture('chart-pivot.xlsx'));
    expect(names).toContain('xl/workbook.xml');
    expect(partsDroppedOnExport(names)).toEqual(['charts', 'pivot tables']);
    expect(partsDroppedOnExport(['xl/slicers/s.xml', 'xl/vbaProject.bin'])).toEqual([
      'slicers and timelines',
      'macros',
    ]);
  });

  it('returns nothing for bytes that are not a zip', () => {
    expect(zipEntryNames(new TextEncoder().encode('not a zip at all, just text'))).toEqual([]);
    expect(zipEntryNames(new Uint8Array(0))).toEqual([]);
  });
});

describe('names and references', () => {
  it('normalises .ods formulas for ExcelJS', () => {
    expect(excelFormula('msoxl:=SUM(B2:B3)')).toBe('SUM(B2:B3)');
    expect(excelFormula('of:=SUM([.B2:.B3];[.C1])')).toBe('SUM(B2:B3,C1)');
    expect(excelFormula("of:=['Other sheet'.A1]*2")).toBe("'Other sheet'!A1*2");
    expect(excelFormula('A1+1')).toBe('A1+1');
  });

  it('makes valid, unique sheet names from Access table names', () => {
    const used = new Set<string>();
    expect(sheetNameFor('Orders/2024: [old]?', used)).toBe('Orders_2024_ _old__');
    expect(sheetNameFor('A'.repeat(40), used)).toBe('A'.repeat(31));
    expect(sheetNameFor('A'.repeat(35), used)).toBe('A'.repeat(27) + ' (2)');
    expect(sheetNameFor('', used)).toBe('Table');
  });

  it('quotes sheet names that need it', () => {
    expect(cellRef('Data', 'A1')).toBe('Data!A1');
    expect(cellRef('Notes ü', 'B2')).toBe("'Notes ü'!B2");
    expect(cellRef("Bob's", 'C3')).toBe("'Bob''s'!C3");
  });

  it('knows which file names are workbooks', () => {
    expect(sheetSourceOf('a.XLSX')).toBe('xlsx');
    expect(sheetSourceOf('b.ods')).toBe('ods');
    expect(sheetSourceOf('c.mdb')).toBe('mdb');
    expect(sheetSourceOf('d.csv')).toBeNull();
  });
});

describe('workbook documents', () => {
  it('renders one line per text cell and previews changes at the right offsets', async () => {
    const doc = await readWorkbook(fixture('formulas.xlsx'), 'xlsx');
    const text = render(doc);
    expect(text.split('\n')[4]).toBe('Data!A2 │ cafÃ©');
    expect(text.split('\n').at(-1)).toBe("'Notes ü'!A1 │ GrÃ¼n");
    const { changes } = analyze(doc);
    const p = preview(doc, changes);
    for (const m of p.marks) {
      const c = changes.find((x) => x.id === m.id)!;
      expect(text.slice(m.start, m.end)).toBe(c.from);
    }
    let out = text;
    for (const e of [...p.edits].reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    expect(out).toBe(render(applyChanges(doc, changes)));
    expect(out.split('\n')[4]).toBe('Data!A2 │ café');
  });

  it('reports characters still not ASCII with sheet locations, and no formula risks', async () => {
    const doc = await readWorkbook(fixture('customers.accdb'), 'accdb');
    const options = { stages: { encoding: true, ascii: true } };
    const { changes } = analyze(doc, options);
    const out = applyChanges(doc, changes, options);
    expect(render(out)).toContain('Customers!B2 │ Cafe Lumiere');
    const report = checkOutput(out, options);
    expect(report.formulaRisks).toEqual([]);
    expect(report.nonAscii[0]).toMatchObject({
      char: 'М',
      location: { type: 'sheet', sheet: 'Customers', cell: 'C3', charPos: 1 },
    });
  });

  it('is saved with writeWorkbook, not serialize', async () => {
    const doc = await readWorkbook(fixture('formulas.xlsx'), 'xlsx');
    expect(() => serialize(doc)).toThrow('writeWorkbook');
  });

  it('gives a clear error for files that are not Access databases', async () => {
    await expect(readWorkbook(new Uint8Array(4096), 'accdb')).rejects.toThrow(
      'could not be read as an Access database',
    );
  });

  it('renders a workbook without text cells as empty text', async () => {
    const doc = (await readWorkbook(fixture('formulas.xlsx'), 'xlsx')) as SheetDoc;
    expect(renderSheet({ ...doc, cells: [] }).text).toBe('');
  });
});
