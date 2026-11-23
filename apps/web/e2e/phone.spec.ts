/** Phone width (Pixel 7): no sideways scrolling, and the change list stacks under the diff. */
import { expect, test } from '@playwright/test';
import { cleanFile, expectNoHorizontalScroll } from './helpers';

for (const path of ['/', '/privacy', '/tools/fix-garbled-text', '/tools/excel-cleaner']) {
  test(`${path} fits the screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

test('result: the change list sits under the before/after view', async ({ page }) => {
  await cleanFile(page, 'customers.csv');
  const diff = await page.getByRole('region', { name: 'Before and after' }).boundingBox();
  const list = await page.getByRole('region', { name: 'Changes' }).boundingBox();
  expect(diff && list).toBeTruthy();
  expect(list!.y).toBeGreaterThanOrEqual(diff!.y + diff!.height);
  expect(list!.width).toBeGreaterThan(300);
  await expectNoHorizontalScroll(page);
});

test('result: a change can be rejected with a tap', async ({ page }) => {
  await cleanFile(page, 'customers.csv');
  await page.getByRole('button', { name: 'Reject all encoding repairs' }).tap();
  await expect(page.getByTestId('summary')).toContainText('1 formula guard');
});
