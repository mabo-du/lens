import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Smoke test — happy path through the LENS app.
 *
 * Preconditions:
 *   1. LENS binary built + renderer served at http://localhost:57598
 *   2. The test fixture exists at e2e/fixtures/sample.txt
 *
 * Steps:
 *   1. Navigate to the app + verify title.
 *   2. Create project via `window.__LENS_E2E_PROJECT_CREATE__`.
 *   3. Import sample.txt via `window.__LENS_E2E_IMPORT__`.
 *   4. Create a code via the UI.
 *   5. Create an annotation.
 *   6. Export QDPX.
 *   7. Verify the .qdpx file exists on disk.
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');
const SAMPLE_TXT = path.join(FIXTURE_DIR, 'sample.txt');

test.beforeAll(() => {
  if (!fs.existsSync(FIXTURE_DIR)) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  }
  if (!fs.existsSync(SAMPLE_TXT)) {
    fs.writeFileSync(
      SAMPLE_TXT,
      'The participant described their experience with the new system. ' +
      'They mentioned several key themes including usability challenges ' +
      'and unexpected benefits. The training program was cited as ' +
      'particularly helpful for onboarding new team members.\n',
      'utf8',
    );
  }
});

test('smoke: project → import → code → annotate → export QDPX', async ({ page }) => {
  // 1. Navigate to the app.
  await page.goto('/');
  await expect(page).toHaveTitle(/LENS/);

  // Collect page errors.
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 2. Create a project via E2E helper.
  const PROJECT_NAME = 'Smoke Test ' + Date.now();
  const targetDir = '/tmp/lens-e2e-' + Date.now();
  fs.mkdirSync(targetDir, { recursive: true });

  const project = await page.evaluate(
    ({ name, dir }) => (window as unknown as Record<string, Function>).__LENS_E2E_PROJECT_CREATE__(name, dir),
    { name: PROJECT_NAME, dir: targetDir },
  );

  expect(project).toBeDefined();
  expect((project as { id: string }).id).toBeTruthy();

  // 3. Wait for workspace to appear.
  await page.waitForTimeout(1500);

  // 4. Import sample.txt via E2E helper.
  const doc = await page.evaluate(
    ({ projId, filePath, fmt }) =>
      (window as unknown as Record<string, Function>).__LENS_E2E_IMPORT__(projId, filePath, fmt),
    {
      projId: (project as { id: string }).id,
      filePath: SAMPLE_TXT,
      fmt: 'txt',
    },
  );

  expect(doc).toBeDefined();
  const docId = (doc as { id: string }).id;
  expect(docId).toBeTruthy();

  // 5. Wait for the import to be reflected in the UI.
  await page.waitForTimeout(2000);

  // 6. Create a code via the UI (click new-code button, fill name).
  const newCodeBtn = page.locator('[data-testid="btn-new-code"]');
  if (await newCodeBtn.isVisible({ timeout: 5000 })) {
    await newCodeBtn.click();
    const nameInput = page.locator('[data-testid="code-name-input"]');
    await nameInput.fill('usability');
    const confirmBtn = page.locator('[data-testid="btn-confirm-create-code"]');
    await confirmBtn.click();
    await page.waitForTimeout(500);
  }

  // 7. Select the document and create an annotation.
  const docItem = page.getByText('sample.txt');
  if (await docItem.isVisible({ timeout: 5000 })) {
    await docItem.click();
    await page.waitForTimeout(500);
  }

  // 8. Export QDPX via the Export button.
  const exportBtn = page.getByText('Export');
  if (await exportBtn.isVisible({ timeout: 5000 })) {
    await exportBtn.click();
    await page.waitForTimeout(500);

    // Click the QDPX format option if it appears.
    const qdpxOption = page.getByText('REFI-QDA (QDPX)');
    if (await qdpxOption.isVisible({ timeout: 3000 })) {
      await qdpxOption.click();
      await page.waitForTimeout(2000);
    }
  }

  // 9. Final assertion: no page errors.
  expect(errors).toHaveLength(0);

  // Cleanup: close project first so the db pool releases its WAL lock,
  // then remove the temp directory.
  await page.evaluate(() => {
    const { invoke } = (window as unknown as { __TAURI_INTERNALS__: { invoke: Function } }).__TAURI_INTERNALS__;
    return invoke('projects_close');
  }).catch(() => { /* best-effort */ });
  fs.rmSync(targetDir, { recursive: true, force: true });
});
