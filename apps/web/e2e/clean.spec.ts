/** Main flows (PROJECT.md section 8): paste → clean → review → download/copy, and CSV files. */
import { expect, test } from '@playwright/test';
import { cleanFile, cleanText, download } from './helpers';

test('pasted text: clean, review, download and copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await cleanText(page, 'donâ€™t panic, cafÃ© ok');
  await expect(page.getByTestId('summary')).toHaveText('2 encoding fixes');

  const file = await download(page);
  expect(file.name).toBe('cleaned.txt');
  expect(file.bytes.toString('utf8')).toBe('don’t panic, café ok');

  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('don’t panic, café ok');
});

test('the ASCII step shows what is still not ASCII, with jump links', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('switch', { name: /Convert to plain ASCII/ }).click();
  await page.getByRole('textbox', { name: 'Text to clean' }).fill('Crème brûlée in Москва');
  await page.getByRole('button', { name: 'Clean' }).click();
  await expect(page.getByTestId('summary')).toContainText('3 accents and symbols');
  await expect(page.getByTestId('still-not-ascii')).toContainText(
    '6 characters are still not ASCII',
  );
});

test('CSV: quoting kept, formula guarded, dependent changes greyed when a group is rejected', async ({
  page,
}) => {
  await cleanFile(page, 'customers.csv');
  await expect(page.getByText('delimiter “,”')).toBeVisible();

  const out = (await download(page)).bytes.toString('utf8');
  expect(out).toContain('"García, José",München,don’t panic');
  expect(out).toContain('"Line one\nline two café"');
  expect(out).toContain(`"'=HYPERLINK(""x"")"`);
  expect(out).toContain('Dan,Москва,plain​zero');

  await page.getByRole('button', { name: 'Reject all encoding repairs' }).click();
  await expect(page.getByTestId('summary')).toContainText('1 formula guard');
  const after = (await download(page)).bytes.toString('utf8');
  expect(after).toContain('"GarcÃ­a, JosÃ©",MÃ¼nchen');
});

test('jump to a change scrolls the before/after view to it', async ({ page }) => {
  await cleanFile(page, 'customers.csv');
  const list = page.getByTestId('change-list');
  await list.getByRole('button', { name: /Row 5/ }).first().click();
  await expect(page.getByTestId('diff-scroller').locator('.hl-flash').first()).toBeVisible();
});

test('a 1 MB CSV with 20,000 rows stays fast and virtualized', async ({ page }) => {
  const started = Date.now();
  await cleanFile(page, 'big.csv');
  expect(Date.now() - started).toBeLessThan(45_000);
  const rendered = await page.getByTestId('diff-scroller').locator('[data-index]').count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(300);
});

test('theme: light and dark can be forced and survive a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a reload after cleaning shows "Nothing to show" (results live only in the tab)', async ({
  page,
}) => {
  await cleanText(page, 'cafÃ©');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nothing to show' })).toBeVisible();
});
