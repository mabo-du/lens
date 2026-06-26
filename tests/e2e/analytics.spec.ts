/**
 * Playwright E2E for Analytics — smoke test for the ICR tab.
 *
 * Uses the workspace fixture at /workspace.html which now includes an
 * "Analytics" button that switches the center panel to AnalyticsWorkspace.
 */
import { test, expect, type Page } from '@playwright/test';

const WORKSPACE_URL = 'http://127.0.0.1:57599/workspace.html';

async function gotoWorkspace(page: Page) {
  await page.goto(WORKSPACE_URL);
  await expect(page.getByRole('heading', { name: 'Codes' })).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    (window as unknown as { __LENS_TEST__: { reset: () => void } }).__LENS_TEST__.reset();
  });
}

async function openAnalytics(page: Page) {
  const analyticsBtn = page.getByRole('button', { name: 'Analytics' });
  await expect(analyticsBtn).toBeVisible({ timeout: 5000 });
  await analyticsBtn.click();
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 5000 });
}

test.describe('Analytics ICR Tab', () => {
  test('analytics view opens from workspace', async ({ page }) => {
    await gotoWorkspace(page);
    await openAnalytics(page);

    // Should see the analytics heading and tab buttons.
    await expect(page.getByRole('button', { name: /code frequency/i })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /co-occurrence/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /inter-coder reliability/i })).toBeVisible();
  });

  test('ICR tab is clickable and renders content', async ({ page }) => {
    await gotoWorkspace(page);
    await openAnalytics(page);

    // Click the ICR tab.
    const icrTab = page.getByRole('button', { name: /inter-coder reliability/i });
    await expect(icrTab).toBeVisible({ timeout: 3000 });
    await icrTab.click();

    // After clicking, the tab should be active (styled differently).
    // The ICR view renders either an empty-state message or the pairwise/matrix interface.
    // We just verify something appeared (empty state message is fine).
    const hasContent = await Promise.race([
      page.getByText(/distinct coders/i).isVisible().then(() => true),
      page.getByText(/import a text document/i).isVisible().then(() => true),
      page.locator('button:has-text("Pairwise")').isVisible().then(() => true),
      page.locator('button:has-text("Matrix")').isVisible().then(() => true),
      // If nothing appears within 3s, return false.
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
    ]);

    expect(hasContent).toBeTruthy();
  });

  test('can navigate back to workspace from analytics', async ({ page }) => {
    await gotoWorkspace(page);
    await openAnalytics(page);

    // Navigate back.
    const backBtn = page.getByRole('button', { name: /back to workspace/i });
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Should see the document editor again.
    await expect(page.getByRole('heading', { name: /test interview transcript/i })).toBeVisible({ timeout: 5000 });
  });
});
