/** Leaving the result page with decisions that aren't downloaded asks first (beforeunload). */
import { expect, test, type Page } from '@playwright/test';
import { cleanText, download } from './helpers';

/** Closes the page as a tab close would, and reports whether the browser asked first. */
async function closeAsksFirst(page: Page): Promise<boolean> {
  let asked = false;
  page.on('dialog', async (dialog) => {
    asked = dialog.type() === 'beforeunload';
    await dialog.accept();
  });
  // Listen first: WebKit can fire "close" before page.close() returns.
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
  return asked;
}

test('no question when nothing was decided', async ({ page, browserName }) => {
  // Playwright's WebKit never finishes a close with runBeforeUnload when the page has no
  // beforeunload handler, so "no question" can't be observed there; "asks" is checked.
  test.skip(browserName === 'webkit', 'WebKit close without a handler never completes');
  await cleanText(page, 'cafÃ© and donâ€™t');
  expect(await closeAsksFirst(page)).toBe(false);
});

test('asks after a decision that was not downloaded', async ({ page }) => {
  await cleanText(page, 'cafÃ© and donâ€™t');
  await page.getByRole('button', { name: 'Reject all encoding repairs' }).click();
  await expect(page.getByTestId('summary')).toHaveText('No changes');
  expect(await closeAsksFirst(page)).toBe(true);
});

test('no question once the decisions are downloaded', async ({ page, browserName }) => {
  // Playwright's WebKit never finishes a close with runBeforeUnload when the page has no
  // beforeunload handler, so "no question" can't be observed there; "asks" is checked.
  test.skip(browserName === 'webkit', 'WebKit close without a handler never completes');
  await cleanText(page, 'cafÃ© and donâ€™t');
  await page.getByRole('checkbox').first().click();
  await expect(page.getByTestId('summary')).toHaveText('1 encoding fix');
  await download(page);
  expect(await closeAsksFirst(page)).toBe(false);
});
