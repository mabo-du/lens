/**
 * Playwright E2E for Search — full-text search across documents and memos.
 *
 * Uses the workspace fixture at /workspace.html which seeds a text document
 * ("Test Interview Transcript") and renders the SearchDialog with mock
 * search_query IPC handler.
 */

import { test, expect, type Page } from '@playwright/test';

const WORKSPACE_URL = 'http://127.0.0.1:57599/workspace.html';

async function gotoWorkspace(page: Page) {
  await page.goto(WORKSPACE_URL);
  // Wait for CodeTree header (confirms the workspace mounted).
  await expect(page.getByRole('heading', { name: 'Codes' })).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    (window as unknown as { __LENS_TEST__: { reset: () => void } }).__LENS_TEST__.reset();
  });
}

test.describe('Search', () => {
  test('Ctrl+F opens the search dialog', async ({ page }) => {
    await gotoWorkspace(page);

    // Press Ctrl+F to open search.
    await page.keyboard.press('Control+f');

    // Search dialog should open.
    await expect(page.getByPlaceholder('Search documents and memos...')).toBeVisible({ timeout: 3000 });
  });

  test('searching for a word in document returns results', async ({ page }) => {
    await gotoWorkspace(page);

    // Open search.
    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Search documents and memos...')).toBeVisible({ timeout: 3000 });

    // Type a word that exists in the document.
    await page.getByPlaceholder('Search documents and memos...').fill('usability');

    // Results should appear (debounced 200ms).
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 5000 });

    // The document title should appear as a result button.
    await expect(page.getByRole('button', { name: /Test Interview Transcript/ })).toBeVisible();

    // The snippet should contain the highlighted match.
    await expect(page.locator('mark')).toBeVisible();
  });

  test('searching for a word not in document shows no results', async ({ page }) => {
    await gotoWorkspace(page);

    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Search documents and memos...')).toBeVisible({ timeout: 3000 });

    await page.getByPlaceholder('Search documents and memos...').fill('xyznonexistent');

    // No results message should appear.
    await expect(page.getByText('No results found')).toBeVisible({ timeout: 5000 });
  });

  test('empty search shows placeholder text', async ({ page }) => {
    await gotoWorkspace(page);

    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Search documents and memos...')).toBeVisible({ timeout: 3000 });

    // Placeholder text inside the results area.
    await expect(page.getByText('Type to search across all your documents and memos...')).toBeVisible();
  });
});
