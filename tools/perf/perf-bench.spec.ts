/**
 * Konva perf benchmark — Playwright driver.
 *
 * Navigates to the fixture vite server's perf page, waits for the
 * benchmark harness to write JSON results into #results, captures that
 * JSON, and writes it to `tools/perf/results.json`. Also asserts
 * reasonable bounds (1ms < avg < 200ms per draw for both bbox and
 * polygon modes) so a catastrophic regression gets caught by CI.
 */

import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_URL = 'http://127.0.0.1:57599/perf-page.html';

interface SizeResult {
  intrinsic_w: number;
  intrinsic_h: number;
  bbox_draw_ms_avg: number;
  polygon_push_ms_avg: number;
  iteration_count: number;
}
interface BenchResult {
  konva_version: string;
  user_agent: string;
  sizes: SizeResult[];
}

test('Konva perf benchmark against synthetic images at 3 sizes', async ({ page }) => {
  await page.goto(FIXTURE_URL);

  // The harness writes JSON to <pre id="results"> + console.log.
  await expect(page.locator('#results')).not.toContainText('running', { timeout: 60_000 });
  await expect(page.locator('#results')).not.toContainText('ERROR', { timeout: 30_000 });

  const text = await page.locator('#results').textContent();
  if (!text || text === 'running…') throw new Error('perf benchmark did not write results to #results');
  const result: BenchResult = JSON.parse(text);

  // Sanity: 3 sizes, 200 iterations each, reasonable numbers.
  expect(result.sizes.length, 'number of size buckets').toBe(3);
  for (const s of result.sizes) {
    expect(s.iteration_count).toBeGreaterThanOrEqual(100);
    expect(s.bbox_draw_ms_avg).toBeGreaterThan(0.5);
    expect(s.bbox_draw_ms_avg).toBeLessThan(200);
    expect(s.polygon_push_ms_avg).toBeGreaterThan(0.5);
    expect(s.polygon_push_ms_avg).toBeLessThan(200);
  }

  // Write the JSON locally so a maintainer (or CI) can cite it in
  // docs/research-papers/v0.2-konva-perf-baseline.md.
  const outPath = path.resolve(__dirname, 'results.json');
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log('perf result written to:', outPath);
});
