/**
 * Cloud mode against a real API (PROJECT.md sections 6, 8 and 14): anonymous jobs, file
 * uploads, and the signed-in flow with saved files, history, rules and settings.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function chooseCloud(page: Page) {
  await page.goto('/');
  await page.getByText('Cloud', { exact: true }).click();
  await expect(page.getByTestId('cloud-note')).toBeVisible();
}

/** Runs Clean in cloud mode and waits for the result page of the new job. */
async function cleanInCloud(page: Page) {
  await page.getByRole('button', { name: 'Clean' }).click();
  await expect(page).toHaveURL(/\/result\/(?!local$)[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByTestId('summary')).toBeVisible({ timeout: 60_000 });
}

async function download(page: Page) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
}

test('anonymous: pasted text is cleaned on the server and set to expire', async ({ page }) => {
  await chooseCloud(page);
  await expect(page.getByTestId('cloud-note')).toContainText('Deleted 1 hour after processing');
  await expect(page.getByTestId('cloud-note')).toContainText('10 of 10 cloud jobs left today');
  await page.getByRole('textbox', { name: 'Text to clean' }).fill('CafÃ© con leche â€” naÃ¯ve');
  await cleanInCloud(page);

  await expect(page.getByTestId('summary')).toHaveText('3 encoding fixes');
  await expect(page.getByTestId('job-note')).toContainText('deleted from our server at');
  // No account: no "Save to my files".
  await expect(page.getByRole('button', { name: 'Save to my files' })).toHaveCount(0);

  const file = await download(page);
  expect(file.name).toBe('cleaned.txt');
  expect(file.text).toBe('Café con leche — naïve');
});

test('anonymous: a CSV file is uploaded and comes back with its name and layout', async ({
  page,
}) => {
  await chooseCloud(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'people.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,city\nJosÃ©,SÃ£o Paulo\n"Anne, Jr",Paris\n'),
  });
  await cleanInCloud(page);
  await expect(page.getByTestId('summary')).toHaveText('2 encoding fixes');

  const file = await download(page);
  expect(file.name).toBe('people-clean.csv');
  expect(file.text).toBe('name,city\nJosé,São Paulo\n"Anne, Jr",Paris\n');
});

test('a job that does not exist (or is someone else’s) shows “This job is gone”', async ({
  page,
}) => {
  await page.goto('/result/no-such-job');
  await expect(page.getByRole('heading', { name: 'This job is gone' })).toBeVisible();
});

test('signed in: job, decisions, save to files, history, rules, settings, log out', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Hello' })).toBeVisible();

  // A job of their own, kept in history.
  await chooseCloud(page);
  await expect(page.getByTestId('cloud-note')).toContainText('Kept in your history');
  await page.getByRole('textbox', { name: 'Text to clean' }).fill('CafÃ© and rÃ©sumÃ©');
  await cleanInCloud(page);
  await expect(page.getByTestId('job-note')).toHaveText('Cloud job · kept in your history');

  // Reject one repair: the server's output follows the decision.
  // The box is controlled: it flips once the server has answered.
  await page.getByRole('checkbox').first().click();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(page.getByTestId('summary')).toHaveText('2 encoding fixes');
  const saveButton = page.getByRole('button', { name: 'Save to my files' });
  await expect(saveButton).toBeDisabled(); // nothing built yet
  expect((await download(page)).text).toBe('CafÃ© and résumé');

  await saveButton.click();
  await expect(page.getByRole('link', { name: 'In my files' })).toBeVisible();

  await page.goto('/app/history');
  await expect(page.getByRole('link', { name: 'Pasted text' })).toBeVisible();
  await expect(page.locator('section li').first()).toContainText('3 encoding fixes · saved');

  await page.goto('/app/files');
  await expect(page.locator('section li').first()).toContainText('cleaned.txt');
  const [fileDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download cleaned.txt' }).click(),
  ]);
  expect(readFileSync(await fileDl.path(), 'utf8')).toBe('CafÃ© and résumé');

  await page.goto('/app/rules');
  await page.getByLabel('Name').fill('Straight apostrophe');
  await page.getByLabel('Find').fill('’');
  await page.getByLabel('Replace with').fill("'");
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('button', { name: 'Delete Straight apostrophe' })).toBeVisible();

  await page.goto('/app/settings');
  await page.getByLabel('Name', { exact: true }).fill('E2E Tester');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Hello, E2E Tester' })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  await page.goto('/app/files');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ffiles$/);
});

test('signed in: saved rules apply in browser mode and in cloud mode', async ({ page }) => {
  const email = `rules-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto('/app/rules');
  await expect(page.getByText('Applied to everything you clean while logged in')).toBeVisible();
  await page.getByLabel('Find').fill('™');
  await page.getByLabel('Replace with').fill('TM');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('“™” → “TM”')).toBeVisible();
  await page.getByLabel('Keep').check();
  await page.getByLabel('Text to keep').fill('é');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('keep “é”')).toBeVisible();

  for (const mode of ['Browser', 'Cloud'] as const) {
    await page.goto('/');
    await page.getByText(mode, { exact: true }).click();
    const ascii = page.getByRole('switch', { name: /Convert to plain ASCII/ });
    if ((await ascii.getAttribute('aria-checked')) !== 'true') await ascii.click();
    await page.locator('summary', { hasText: 'Your rules' }).click();
    await expect(page.getByText('2 on')).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to clean' }).fill('Acme™ café naïve');
    await page.getByRole('button', { name: 'Clean' }).click();
    await expect(page.getByTestId('summary')).toHaveText('1 rule change · 1 accent or symbol', {
      timeout: 60_000,
    });
    expect((await download(page)).text, mode).toBe('AcmeTM café naive');
  }
});
