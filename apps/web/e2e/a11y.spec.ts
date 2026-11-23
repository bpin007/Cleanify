/**
 * axe-core accessibility checks (PROJECT.md section 20): no serious or critical WCAG 2.1
 * A/AA violations on the main pages, in light and dark, on desktop and phone.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { cleanFile, cleanText } from './helpers';

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cleanify-theme', t), theme);
    });

    const pages = [
      '/',
      '/privacy',
      '/tools/fix-garbled-text',
      '/tools/remove-accents',
      '/tools/remove-invisible-characters',
      '/tools/translate-to-english',
      '/tools/csv-cleaner',
      '/tools/excel-cleaner',
      '/no-such-page',
      '/result/local',
    ];
    for (const path of pages) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        await expectAccessible(page);
      });
    }

    test('home with the ASCII options open', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('switch', { name: /Convert to plain ASCII/ }).click();
      await expectAccessible(page);
    });

    test('result for pasted text with warnings', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('switch', { name: /Convert to plain ASCII/ }).click();
      await page.getByRole('textbox', { name: 'Text to clean' }).fill('CafÃ© naïve Москва​');
      await page.getByRole('button', { name: 'Clean' }).click();
      await expect(page.getByTestId('still-not-ascii')).toBeVisible();
      await expectAccessible(page);
    });

    test('result for a CSV file with a rejected group', async ({ page }) => {
      await cleanFile(page, 'customers.csv');
      await page.getByRole('button', { name: 'Reject all encoding repairs' }).click();
      await expectAccessible(page);
    });

    test('result for a workbook', async ({ page }) => {
      await cleanFile(page, 'chart-pivot.xlsx');
      await expectAccessible(page);
    });

    test('blocked save dialog', async ({ page }) => {
      await cleanText(page, 'ok 中');
      await page.getByRole('combobox', { name: 'Save as' }).selectOption({ label: 'Windows-1252' });
      await page.getByRole('button', { name: 'Download' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page);
    });
  });
}
