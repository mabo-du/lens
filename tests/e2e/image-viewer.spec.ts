/**
 * Playwright E2E for ImageViewer polygon mode + action dialog flow.
 *
 * Drives the actual production React component (`ImageViewer.tsx`) via the
 * Playwright fixture (`tests/e2e/fixture/index.html`). The fixture mounts
 * Tauri-IPC shim handlers (see `main.tsx`), so `imagePolygonsIpc.create`
 * resolves against an in-memory store that's inspectable from Playwright
 * via `page.evaluate(() => window.__LENS_TEST__)`.
 */

import { test, expect, type Page } from '@playwright/test';

/**
 * Absolute URL of the fixture vite dev server.
 * (BaseURL inheritance for `page.goto('/')` works in newer Playwright
 * but is fragile; an explicit absolute URL is bulletproof and matches
 * the round-77 defensive config in playwright.config.ts.)
 */
const FIXTURE_URL = 'http://127.0.0.1:57599/';

async function gotoFixture(page: Page) {
  await page.goto(FIXTURE_URL);
  // Wait for image + Stage to render (data-testid hooks are wired).
  await expect(page.getByTestId('mode-bbox')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('mode-polygon')).toBeVisible();
  // Reset mock state at the start of every test so IPC invocations +
  // fixture regions/polygons are isolated per test.
  await page.evaluate(() => {
    (window as unknown as { __LENS_TEST__: { reset: () => void } }).__LENS_TEST__.reset();
  });
}

async function pickFirstCode(page: Page) {
  // The fixture's single code is rendered as a button in the toolbar.
  await page.getByRole('button', { name: 'Test Code' }).click();
}

test.describe('ImageViewer polygon mode', () => {
  test('mode toggle switches from Rectangle to Polygon', async ({ page }) => {
    await gotoFixture(page);
    // Default: Rectangle tab selected.
    await expect(page.getByRole('tab', { name: 'Rectangle' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Polygon' })).toHaveAttribute('aria-selected', 'false');

    await page.getByTestId('mode-polygon').click();
    await expect(page.getByRole('tab', { name: 'Polygon' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Rectangle' })).toHaveAttribute('aria-selected', 'false');
  });

  test('click 4 vertices + Enter commits a 4-vertex polygon via IPC', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    await page.getByTestId('mode-polygon').click();

    // Click the canvas at 4 distinct points (Stage is 256×256 in fixture).
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    const offset = (dx: number, dy: number) => ({
      x: box.x + dx,
      y: box.y + dy,
    });
    await page.mouse.click(box.x + 40, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.mouse.click(box.x + 40, box.y + 200);

    // Press Enter to commit.
    await page.keyboard.press('Enter');

    // Assert IPC was called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string; args: unknown }> } })
        .__LENS_TEST__.invocations,
    );
    const createCalls = invocations.filter(i => i.cmd === 'image_polygon_create');
    expect(createCalls.length, 'image_polygon_create IPC count').toBeGreaterThanOrEqual(1);

    const args = createCalls[0]!.args as { documentId: string; codeId: string; verticesJson?: string };
    expect(args.documentId).toBe('doc-1');
    expect(args.codeId).toBe('code-1');
    const vertices = JSON.parse(args.verticesJson!);
    // 4 vertices; raw pixel coords, normalised to 0..1 at the IPC boundary.
    expect(vertices.length).toBe(4);
    for (const pair of vertices) {
      expect(pair.length).toBe(2);
      for (const n of pair) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    }

    // After commit, draftVertices clears and the polygon appears in the fixture list.
    const polygons = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { fixture: { polygons: unknown[] } } })
        .__LENS_TEST__.fixture.polygons,
    );
    expect(polygons.length).toBe(1);

    // Suppress unused-variable warnings (offset is a helper kept for future tests).
    void offset;
  });

  test('right-click a committed polygon opens the action Dialog', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    await page.getByTestId('mode-polygon').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // 1. Draw a 3-vertex triangle — 3 clicks then Enter to commit.
    await page.mouse.click(box.x + 100, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.mouse.click(box.x + 40, box.y + 220);
    await page.keyboard.press('Enter');

    // 2. Right-click the polygon area. Retry until React/Konva has
    //    rendered the committed polygon — the mock IPC backend may
    //    have the polygon before the <Line> is on the Stage.
    await expect(async () => {
      await page.mouse.click(box.x + 120, box.y + 120, { button: 'right' });
      await expect(page.getByTestId('region-action-edit-memo')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 5000 });

    await expect(page.getByTestId('region-action-delete')).toBeVisible();
  });

  test('Edit Memo... button in action Dialog opens RegionMemoDialog with codeName', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    await page.getByTestId('mode-polygon').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // Commit a polygon first.
    await page.mouse.click(box.x + 100, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.mouse.click(box.x + 40, box.y + 220);
    await page.keyboard.press('Enter');

    // Open the action Dialog via right-click on the polygon area.
    // Retry until React/Konva renders the committed polygon.
    await expect(async () => {
      await page.mouse.click(box.x + 120, box.y + 120, { button: 'right' });
      await expect(page.getByTestId('region-action-edit-memo')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 5000 });

    // Click Edit Memo... → RegionMemoDialog should open with the code's name.
    // dispatchEvent('click') fires a native DOM click directly on the button,
    // triggering React's onClick handler while entirely bypassing Playwright's
    // actionability checks. This avoids the data-base-ui-inert / aria-hidden
    // interception that occurs when Base UI's Dialog Portal renders alongside
    // the inert #root div (elementFromPoint hits #root instead of the button).
    await page.getByTestId('region-action-edit-memo').dispatchEvent('click');
    // RegionMemoDialog is the same Dialog primitive; we look for its title.
    // Playwright's auto-retrying assertion polls until the dialog appears.
    await expect(page.getByText('Region Memo')).toBeVisible({ timeout: 10_000 });
    // The "For code: <name>" sub-line shows the polygon code's name.
    await expect(page.getByText('Test Code', { exact: true })).toBeVisible();
  });
});
