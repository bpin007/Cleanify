import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Download, type Page } from '@playwright/test';

export const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Opens the home tool, picks a fixture file and cleans it with the current switches. */
export async function cleanFile(page: Page, name: string, path = '/') {
  await page.goto(path);
  await page.getByTestId('file-input').setInputFiles(fixture(name));
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole('button', { name: 'Clean' }).click();
  await expect(page).toHaveURL(/\/result\/local$/, { timeout: 45_000 });
  await expect(page.getByTestId('summary')).toBeVisible();
}

export async function cleanText(page: Page, text: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Text to clean' }).fill(text);
  await page.getByRole('button', { name: 'Clean' }).click();
  await expect(page).toHaveURL(/\/result\/local$/);
  await expect(page.getByTestId('summary')).toBeVisible();
}

export async function download(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const [dl]: [Download, void] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

/** The page never scrolls sideways (phone layouts). */
export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}
