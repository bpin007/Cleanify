/** Everything works with a keyboard only, with a visible focus ring (PROJECT.md section 9). */
import { expect, test, type Page } from '@playwright/test';

// Safari's Tab skips links by default (Option+Tab includes them), and Playwright's
// WebKit doesn't emulate Option+Tab, so keyboard paths are checked in Chromium and Firefox.
test.skip(({ browserName }) => browserName === 'webkit', 'WebKit Tab order differs (see above)');

/** Presses Tab until the focused element matches, like a keyboard user would. */
async function tabTo(page: Page, matches: (el: Element) => boolean, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(`(${matches.toString()})(document.activeElement)`);
    if (hit) return;
  }
  throw new Error('Never reached the element with Tab');
}

async function expectFocusRing(page: Page) {
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
}

test('clean, review and decide using only the keyboard', async ({ page }) => {
  await page.goto('/');

  // The first Tab reaches the skip link.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();

  await tabTo(page, (el) => el.getAttribute('aria-label') === 'Text to clean');
  await page.keyboard.type('cafÃ© and donâ€™t');

  // The ASCII switch toggles with Space.
  await tabTo(
    page,
    (el) =>
      el.getAttribute('role') === 'switch' &&
      /ASCII/.test(
        el.id ? (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '') : '',
      ),
  );
  await expectFocusRing(page);
  await page.keyboard.press('Space');
  await expect(page.getByRole('switch', { name: /Convert to plain ASCII/ })).toBeChecked();

  await tabTo(page, (el) => el.textContent?.trim() === 'Clean');
  await expectFocusRing(page);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('summary')).toContainText('2 encoding fixes');

  // Reject a whole group from the keyboard.
  await tabTo(page, (el) => el.getAttribute('aria-label') === 'Reject all encoding repairs');
  await expectFocusRing(page);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('summary')).toHaveText('No changes');

  // Re-accept one change with Space on its checkbox.
  await tabTo(
    page,
    (el) => el instanceof HTMLInputElement && el.type === 'checkbox' && !el.disabled,
  );
  await expectFocusRing(page);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('summary')).toContainText('1 encoding fix');

  // Jump to its location with Enter.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('diff-scroller').locator('.hl-flash').first()).toBeVisible();
});

test('a file can be chosen and the theme changed from the keyboard', async ({ page }) => {
  await page.goto('/');
  await tabTo(page, (el) => el.textContent?.trim() === 'Choose a file');
  await expectFocusRing(page);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  expect((await chooser).isMultiple()).toBe(false);

  await page.goto('/');
  await tabTo(page, (el) => el.getAttribute('role') === 'radio' && el.textContent === 'Dark');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
