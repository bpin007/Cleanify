/** Excel, OpenDocument and Access files in the browser (PROJECT.md sections 7 and 13). */
import { expect, test } from '@playwright/test';
import { readWorkbook } from '@cleanify/engine';
import { cleanFile, download } from './helpers';

test('.xlsx: text cells cleaned, formulas and numbers kept, downloaded as .xlsx', async ({
  page,
}) => {
  await cleanFile(page, 'formulas.xlsx');
  await expect(page.getByText('Excel workbook · 10.1 KB · 2 sheets')).toBeVisible();
  await expect(page.getByText('Data!A2 │ cafÃ©')).toBeVisible();
  await expect(page.getByText(/Only text cells are checked and changed/)).toBeVisible();
  // No encoding choice and no Copy for workbooks.
  await expect(page.getByText('Saves as an Excel workbook (.xlsx)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0);

  const file = await download(page);
  expect(file.name).toBe('formulas-clean.xlsx');
  const doc = await readWorkbook(new Uint8Array(file.bytes), 'xlsx');
  const cell = (address: string, sheet = 'Data') =>
    doc.cells.find((c) => c.sheet === sheet && c.address === address)?.value;
  expect(cell('A2')).toBe('café');
  expect(cell('A3')).toBe('don’t');
  expect(cell('D5')).toBe('Bold café');
  expect(cell('A1', 'Notes ü')).toBe('Grün');
  // Formulas are not text cells, so they are not in the list: they were left alone.
  expect(doc.cells.some((c) => c.address === 'B4')).toBe(false);
});

test('.xlsx with a chart and a pivot table warns before download', async ({ page }) => {
  await cleanFile(page, 'chart-pivot.xlsx');
  await expect(page.getByText(/This workbook has charts and pivot tables/)).toBeVisible();
  await expect(page.getByTestId('export-note')).toContainText('won’t have the charts');
});

test('.xls is read with SheetJS and warns that styles are not kept', async ({ page }) => {
  await cleanFile(page, 'legacy.xls');
  await expect(page.getByText(/not its styles/)).toBeVisible();
  const file = await download(page);
  expect(file.name).toBe('legacy-clean.xlsx');
});

test('Access database: one sheet per table, explained, binary column skipped', async ({ page }) => {
  await cleanFile(page, 'customers.accdb');
  await expect(page.getByText(/Access database · .* · 2 tables/)).toBeVisible();
  await expect(
    page.getByText(/saved as an Excel workbook \(\.xlsx\): one sheet per table/),
  ).toBeVisible();
  await expect(page.getByText(/Customers\.Photo/)).toBeVisible();
  const file = await download(page);
  expect(file.name).toBe('customers-clean.xlsx');
  const doc = await readWorkbook(new Uint8Array(file.bytes), 'xlsx');
  expect(doc.sheets).toEqual(['Customers', 'Order Lines']);
  expect(doc.cells.find((c) => c.address === 'B2')?.value).toBe('Café Lumière');
});
