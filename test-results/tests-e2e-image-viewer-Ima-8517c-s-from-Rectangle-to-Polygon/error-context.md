# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/image-viewer.spec.ts >> ImageViewer polygon mode >> mode toggle switches from Rectangle to Polygon
- Location: tests/e2e/image-viewer.spec.ts:39:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:57599/
Call log:
  - navigating to "http://127.0.0.1:57599/", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * Playwright E2E for ImageViewer polygon mode + action dialog flow.
  3   |  *
  4   |  * Drives the actual production React component (`ImageViewer.tsx`) via the
  5   |  * Playwright fixture (`tests/e2e/fixture/index.html`). The fixture mounts
  6   |  * Tauri-IPC shim handlers (see `main.tsx`), so `imagePolygonsIpc.create`
  7   |  * resolves against an in-memory store that's inspectable from Playwright
  8   |  * via `page.evaluate(() => window.__LENS_TEST__)`.
  9   |  */
  10  | 
  11  | import { test, expect, type Page } from '@playwright/test';
  12  | 
  13  | /**
  14  |  * Absolute URL of the fixture vite dev server.
  15  |  * (BaseURL inheritance for `page.goto('/')` works in newer Playwright
  16  |  * but is fragile; an explicit absolute URL is bulletproof and matches
  17  |  * the round-77 defensive config in playwright.config.ts.)
  18  |  */
  19  | const FIXTURE_URL = 'http://127.0.0.1:57599/';
  20  | 
  21  | async function gotoFixture(page: Page) {
> 22  |   await page.goto(FIXTURE_URL);
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:57599/
  23  |   // Wait for image + Stage to render (data-testid hooks are wired).
  24  |   await expect(page.getByTestId('mode-bbox')).toBeVisible({ timeout: 10_000 });
  25  |   await expect(page.getByTestId('mode-polygon')).toBeVisible();
  26  |   // Reset mock state at the start of every test so IPC invocations +
  27  |   // fixture regions/polygons are isolated per test.
  28  |   await page.evaluate(() => {
  29  |     (window as unknown as { __LENS_TEST__: { reset: () => void } }).__LENS_TEST__.reset();
  30  |   });
  31  | }
  32  | 
  33  | async function pickFirstCode(page: Page) {
  34  |   // The fixture's single code is rendered as a button in the toolbar.
  35  |   await page.getByRole('button', { name: 'Test Code' }).click();
  36  | }
  37  | 
  38  | test.describe('ImageViewer polygon mode', () => {
  39  |   test('mode toggle switches from Rectangle to Polygon', async ({ page }) => {
  40  |     await gotoFixture(page);
  41  |     // Default: Rectangle tab selected.
  42  |     await expect(page.getByRole('tab', { name: 'Rectangle' })).toHaveAttribute('aria-selected', 'true');
  43  |     await expect(page.getByRole('tab', { name: 'Polygon' })).toHaveAttribute('aria-selected', 'false');
  44  | 
  45  |     await page.getByTestId('mode-polygon').click();
  46  |     await expect(page.getByRole('tab', { name: 'Polygon' })).toHaveAttribute('aria-selected', 'true');
  47  |     await expect(page.getByRole('tab', { name: 'Rectangle' })).toHaveAttribute('aria-selected', 'false');
  48  |   });
  49  | 
  50  |   test('click 4 vertices + Enter commits a 4-vertex polygon via IPC', async ({ page }) => {
  51  |     await gotoFixture(page);
  52  |     await pickFirstCode(page);
  53  |     await page.getByTestId('mode-polygon').click();
  54  | 
  55  |     // Click the canvas at 4 distinct points (Stage is 256×256 in fixture).
  56  |     const canvas = page.locator('canvas').first();
  57  |     const box = await canvas.boundingBox();
  58  |     if (!box) throw new Error('Stage canvas not found');
  59  | 
  60  |     const offset = (dx: number, dy: number) => ({
  61  |       x: box.x + dx,
  62  |       y: box.y + dy,
  63  |     });
  64  |     await page.mouse.click(box.x + 40, box.y + 40);
  65  |     await page.mouse.click(box.x + 200, box.y + 40);
  66  |     await page.mouse.click(box.x + 200, box.y + 200);
  67  |     await page.mouse.click(box.x + 40, box.y + 200);
  68  | 
  69  |     // Press Enter to commit.
  70  |     await page.keyboard.press('Enter');
  71  | 
  72  |     // Assert IPC was called.
  73  |     const invocations = await page.evaluate(() =>
  74  |       (window as unknown as { __LENS_TEST__: { invocations: Array<{ cmd: string; args: unknown }> } })
  75  |         .__LENS_TEST__.invocations,
  76  |     );
  77  |     const createCalls = invocations.filter(i => i.cmd === 'image_polygon_create');
  78  |     expect(createCalls.length, 'image_polygon_create IPC count').toBeGreaterThanOrEqual(1);
  79  | 
  80  |     const args = createCalls[0]!.args as { documentId: string; codeId: string; verticesJson?: string };
  81  |     expect(args.documentId).toBe('doc-1');
  82  |     expect(args.codeId).toBe('code-1');
  83  |     const vertices = JSON.parse(args.verticesJson!);
  84  |     // 4 vertices; raw pixel coords, normalised to 0..1 at the IPC boundary.
  85  |     expect(vertices.length).toBe(4);
  86  |     for (const pair of vertices) {
  87  |       expect(pair.length).toBe(2);
  88  |       for (const n of pair) {
  89  |         expect(n).toBeGreaterThanOrEqual(0);
  90  |         expect(n).toBeLessThanOrEqual(1);
  91  |       }
  92  |     }
  93  | 
  94  |     // After commit, draftVertices clears and the polygon appears in the fixture list.
  95  |     const polygons = await page.evaluate(() =>
  96  |       (window as unknown as { __LENS_TEST__: { fixture: { polygons: unknown[] } } })
  97  |         .__LENS_TEST__.fixture.polygons,
  98  |     );
  99  |     expect(polygons.length).toBe(1);
  100 | 
  101 |     // Suppress unused-variable warnings (offset is a helper kept for future tests).
  102 |     void offset;
  103 |   });
  104 | 
  105 |   test('right-click a committed polygon opens the action Dialog', async ({ page }) => {
  106 |     await gotoFixture(page);
  107 |     await pickFirstCode(page);
  108 |     await page.getByTestId('mode-polygon').click();
  109 | 
  110 |     const canvas = page.locator('canvas').first();
  111 |     const box = await canvas.boundingBox();
  112 |     if (!box) throw new Error('Stage canvas not found');
  113 | 
  114 |     // 1. Draw a 3-vertex triangle (different from the rectangle today).
  115 |     await page.mouse.click(box.x + 100, box.y + 40);
  116 |     await page.mouse.click(box.x + 200, box.y + 200);
  117 |     await page.mouse.click(box.x + 40, box.y + 220);
  118 |     await page.keyboard.press('Escape'); // not yet 3 verts; we just need 3 then Enter
  119 |     // Actually Esc clears — need to re-add. Simpler: add the third vertex + Enter.
  120 |     await page.mouse.click(box.x + 40, box.y + 220);
  121 |     await page.keyboard.press('Enter');
  122 | 
```