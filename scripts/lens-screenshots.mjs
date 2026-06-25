import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';

mkdirSync('docs/assets/screenshots', { recursive: true });
const OUT = 'docs/assets/screenshots';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:57599/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="mode-bbox"]', { timeout: 15000 });
await page.waitForSelector('[data-testid="mode-polygon"]', { timeout: 15000 });
await page.waitForTimeout(700);

// 01 - landing / initial ImageViewer mounted in fixture
await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: false });

// 02 - bbox mode, code picked, region mid-drag
await page.getByRole('button', { name: 'Test Code' }).click();
await page.waitForTimeout(200);
const canvas = page.locator('canvas').first();
const cbox = await canvas.boundingBox();
if (!cbox) throw new Error('canvas not found');
await page.mouse.move(cbox.x + 50, cbox.y + 50);
await page.mouse.down();
await page.mouse.move(cbox.x + 200, cbox.y + 200, { steps: 8 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-bbox-dragging.png`, fullPage: false });
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/03-bbox-committed.png`, fullPage: false });

// 04 - polygon mode selected (toolbar pill on left)
await page.getByTestId('mode-polygon').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-polygon-mode-selected.png`, fullPage: false });

// 05 - polygon vertices placed (in-flight, dashed preview line)
await page.mouse.click(cbox.x + 30, cbox.y + 30);
await page.mouse.click(cbox.x + 220, cbox.y + 30);
await page.mouse.click(cbox.x + 220, cbox.y + 220);
await page.mouse.click(cbox.x + 30, cbox.y + 220);
await page.mouse.move(cbox.x + 100, cbox.y + 100);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-polygon-inflight.png`, fullPage: false });

// 06 - polygon committed (Enter)
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/06-polygon-committed.png`, fullPage: false });

// 07 - right-click on committed polygon opens action menu
await page.mouse.click(cbox.x + 125, cbox.y + 125, { button: 'right' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/07-region-action-menu.png`, fullPage: false });

await browser.close();
console.log('OK captured 7 screenshots to docs/assets/screenshots/');
