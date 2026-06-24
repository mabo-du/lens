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
const FIXTURE_URL = 'http://localhost:57599/';

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

    // 1. Draw a 3-vertex triangle (different from the rectangle today).
    await page.mouse.click(box.x + 100, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.mouse.click(box.x + 40, box.y + 220);
    await page.keyboard.press('Escape'); // not yet 3 verts; we just need 3 then Enter
    // Actually Esc clears — need to re-add. Simpler: add the third vertex + Enter.
    await page.mouse.click(box.x + 40, box.y + 220);
    await page.keyboard.press('Enter');

    // Wait until the polygon is in the fixture store.
    await expect.poll(async () => {
      const ps = await page.evaluate(() =>
        (window as unknown as { __LENS_TEST__: { fixture: { polygons: { length: number }[] } } })
          .__LENS_TEST__.fixture.polygons,
      );
      return ps.length;
    }, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    // 2. Right-click anywhere on the canvas (the polygon fills the central portion).
    // The action Dialog only opens for clicks on a shape, so click in the polygon's
    // expected bounding area.
    await page.mouse.click(box.x + 120, box.y + 120, { button: 'right' });

    await expect(page.getByTestId('region-action-edit-memo')).toBeVisible({ timeout: 3000 });
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
    await expect.poll(async () => {
      const ps = await page.evaluate(() =>
        (window as unknown as { __LENS_TEST__: { fixture: { polygons: { length: number }[] } } })
          .__LENS_TEST__.fixture.polygons,
      );
      return ps.length;
    }, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    // Open the action Dialog via right-click on the polygon area.
    await page.mouse.click(box.x + 120, box.y + 120, { button: 'right' });
    await expect(page.getByTestId('region-action-edit-memo')).toBeVisible({ timeout: 3000 });

    // Click Edit Memo... → RegionMemoDialog should open with the code's name in the header.
    await page.getByTestId('region-action-edit-memo').click();
    // RegionMemoDialog is the same Dialog primitive; we look for its title.
    await expect(page.getByText('Region Memo')).toBeVisible({ timeout: 3000 });
    // The "For code: <name>" sub-line shows the polygon code's name.
    await expect(page.getByText('Test Code', { exact: true })).toBeVisible();
  });
});
