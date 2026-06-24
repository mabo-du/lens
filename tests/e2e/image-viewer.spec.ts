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

test.describe('ImageViewer bbox mode', () => {
  test('drag-to-create rectangle region commits via IPC', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    // Default mode is bbox — verify.
    await expect(page.getByRole('tab', { name: 'Rectangle' })).toHaveAttribute('aria-selected', 'true');

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // Drag from (40,40) to (200,200) — exceeds MIN_DRAG_PX (4px) so
    // it creates a region rather than being suppressed as a click.
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // Assert image_selection_create IPC was called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string; args: unknown }> } })
        .__LENS_TEST__.invocations,
    );
    const createCalls = invocations.filter(i => i.cmd === 'image_selection_create');
    expect(createCalls.length, 'image_selection_create IPC count').toBe(1);

    const args = createCalls[0]!.args as {
      documentId: string;
      codeId: string;
      bboxLeft: number;
      bboxTop: number;
      bboxRight: number;
      bboxBottom: number;
    };
    expect(args.documentId).toBe('doc-1');
    expect(args.codeId).toBe('code-1');
    // All coords normalised 0..1.
    for (const v of [args.bboxLeft, args.bboxTop, args.bboxRight, args.bboxBottom]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(args.bboxLeft).toBeLessThan(args.bboxRight);
    expect(args.bboxTop).toBeLessThan(args.bboxBottom);

    // Region appears in fixture store.
    const regions = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { fixture: { regions: unknown[] } } })
        .__LENS_TEST__.fixture.regions,
    );
    expect(regions.length).toBe(1);
  });

  test('sub-MIN_DRAG_PX drag is suppressed (no accidental click-create)', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // Drag only 2px — below MIN_DRAG_PX (4px). Should NOT create a region.
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 102, box.y + 100, { steps: 3 });
    await page.mouse.up();

    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string }> } })
        .__LENS_TEST__.invocations,
    );
    expect(invocations.filter(i => i.cmd === 'image_selection_create').length).toBe(0);
  });
});

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
    // Scope to the RegionMemoDialog — the action Dialog also contains
    // "Test Code" while it's animating closed (100ms), causing a strict
    // mode violation when getByText matches both.
    await expect(
      page.getByRole('dialog', { name: 'Region Memo' }).getByText('Test Code', { exact: true }),
    ).toBeVisible();
  });

  test('Escape cancels an in-flight polygon draft', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    await page.getByTestId('mode-polygon').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // Place 3 vertices, then cancel.
    await page.mouse.click(box.x + 100, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.mouse.click(box.x + 40, box.y + 220);
    await page.keyboard.press('Escape');

    // No image_polygon_create IPC should have been called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string }> } })
        .__LENS_TEST__.invocations,
    );
    expect(invocations.filter(i => i.cmd === 'image_polygon_create').length).toBe(0);

    // Polygon fixture store is still empty.
    const polygons = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { fixture: { polygons: unknown[] } } })
        .__LENS_TEST__.fixture.polygons,
    );
    expect(polygons.length).toBe(0);
  });

  test('Enter with < 3 vertices shows error toast and does not commit', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    await page.getByTestId('mode-polygon').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // Place only 2 vertices, then press Enter.
    await page.mouse.click(box.x + 100, box.y + 40);
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.keyboard.press('Enter');

    // Error toast should appear.
    await expect(page.getByText('at least 3 vertices')).toBeVisible({ timeout: 3000 });

    // No IPC call made.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string }> } })
        .__LENS_TEST__.invocations,
    );
    expect(invocations.filter(i => i.cmd === 'image_polygon_create').length).toBe(0);
  });

  test('right-click on empty canvas commits an in-flight polygon draft', async ({ page }) => {
    await gotoFixture(page);
    await pickFirstCode(page);
    await page.getByTestId('mode-polygon').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Stage canvas not found');

    // Place 3 vertices forming a small triangle near the top-left.
    await page.mouse.click(box.x + 20, box.y + 20);
    await page.mouse.click(box.x + 80, box.y + 20);
    await page.mouse.click(box.x + 50, box.y + 80);

    // Right-click on empty canvas far from the triangle (bottom-right).
    // This triggers stage-level onContextMenu → commitPolygon().
    await page.mouse.click(box.x + 230, box.y + 230, { button: 'right' });

    // IPC should have been called.
    const invocations = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string }> } })
        .__LENS_TEST__.invocations,
    );
    expect(invocations.filter(i => i.cmd === 'image_polygon_create').length).toBe(1);

    // Polygon appears in fixture store.
    const polygons = await page.evaluate(() =>
      (window as unknown as { __LENS_TEST__: { fixture: { polygons: unknown[] } } })
        .__LENS_TEST__.fixture.polygons,
    );
    expect(polygons.length).toBe(1);
  });
});
