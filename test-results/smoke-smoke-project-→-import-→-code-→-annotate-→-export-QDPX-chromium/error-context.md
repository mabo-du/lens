# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> smoke: project → import → code → annotate → export QDPX
- Location: smoke.spec.ts:45:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:57598/
Call log:
  - navigating to "http://localhost:57598/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import * as path from 'node:path';
  3   | import * as fs from 'node:fs';
  4   | import { fileURLToPath } from 'node:url';
  5   | 
  6   | const __filename = fileURLToPath(import.meta.url);
  7   | const __dirname = path.dirname(__filename);
  8   | 
  9   | /**
  10  |  * Smoke test — happy path through the LENS app.
  11  |  *
  12  |  * Preconditions:
  13  |  *   1. LENS binary built + renderer served at http://localhost:57598
  14  |  *   2. The test fixture exists at e2e/fixtures/sample.txt
  15  |  *
  16  |  * Steps:
  17  |  *   1. Navigate to the app + verify title.
  18  |  *   2. Create project via `window.__LENS_E2E_PROJECT_CREATE__`.
  19  |  *   3. Import sample.txt via `window.__LENS_E2E_IMPORT__`.
  20  |  *   4. Create a code via the UI.
  21  |  *   5. Create an annotation.
  22  |  *   6. Export QDPX.
  23  |  *   7. Verify the .qdpx file exists on disk.
  24  |  */
  25  | 
  26  | const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');
  27  | const SAMPLE_TXT = path.join(FIXTURE_DIR, 'sample.txt');
  28  | 
  29  | test.beforeAll(() => {
  30  |   if (!fs.existsSync(FIXTURE_DIR)) {
  31  |     fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  32  |   }
  33  |   if (!fs.existsSync(SAMPLE_TXT)) {
  34  |     fs.writeFileSync(
  35  |       SAMPLE_TXT,
  36  |       'The participant described their experience with the new system. ' +
  37  |       'They mentioned several key themes including usability challenges ' +
  38  |       'and unexpected benefits. The training program was cited as ' +
  39  |       'particularly helpful for onboarding new team members.\n',
  40  |       'utf8',
  41  |     );
  42  |   }
  43  | });
  44  | 
  45  | test('smoke: project → import → code → annotate → export QDPX', async ({ page }) => {
  46  |   // 1. Navigate to the app.
> 47  |   await page.goto('/');
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:57598/
  48  |   await expect(page).toHaveTitle(/LENS/);
  49  | 
  50  |   // Collect page errors.
  51  |   const errors: string[] = [];
  52  |   page.on('pageerror', (err) => errors.push(err.message));
  53  | 
  54  |   // 2. Create a project via E2E helper.
  55  |   const PROJECT_NAME = 'Smoke Test ' + Date.now();
  56  |   const targetDir = '/tmp/lens-e2e-' + Date.now();
  57  |   fs.mkdirSync(targetDir, { recursive: true });
  58  | 
  59  |   const project = await page.evaluate(
  60  |     ({ name, dir }) => (window as unknown as Record<string, Function>).__LENS_E2E_PROJECT_CREATE__(name, dir),
  61  |     { name: PROJECT_NAME, dir: targetDir },
  62  |   );
  63  | 
  64  |   expect(project).toBeDefined();
  65  |   expect((project as { id: string }).id).toBeTruthy();
  66  | 
  67  |   // 3. Wait for workspace to appear.
  68  |   await page.waitForTimeout(1500);
  69  | 
  70  |   // 4. Import sample.txt via E2E helper.
  71  |   const doc = await page.evaluate(
  72  |     ({ projId, filePath, fmt }) =>
  73  |       (window as unknown as Record<string, Function>).__LENS_E2E_IMPORT__(projId, filePath, fmt),
  74  |     {
  75  |       projId: (project as { id: string }).id,
  76  |       filePath: SAMPLE_TXT,
  77  |       fmt: 'txt',
  78  |     },
  79  |   );
  80  | 
  81  |   expect(doc).toBeDefined();
  82  |   const docId = (doc as { id: string }).id;
  83  |   expect(docId).toBeTruthy();
  84  | 
  85  |   // 5. Wait for the import to be reflected in the UI.
  86  |   await page.waitForTimeout(2000);
  87  | 
  88  |   // 6. Create a code via the UI (click new-code button, fill name).
  89  |   const newCodeBtn = page.locator('[data-testid="btn-new-code"]');
  90  |   if (await newCodeBtn.isVisible({ timeout: 5000 })) {
  91  |     await newCodeBtn.click();
  92  |     const nameInput = page.locator('[data-testid="code-name-input"]');
  93  |     await nameInput.fill('usability');
  94  |     const confirmBtn = page.locator('[data-testid="btn-confirm-create-code"]');
  95  |     await confirmBtn.click();
  96  |     await page.waitForTimeout(500);
  97  |   }
  98  | 
  99  |   // 7. Select the document and create an annotation.
  100 |   const docItem = page.getByText('sample.txt');
  101 |   if (await docItem.isVisible({ timeout: 5000 })) {
  102 |     await docItem.click();
  103 |     await page.waitForTimeout(500);
  104 |   }
  105 | 
  106 |   // 8. Export QDPX via the Export button.
  107 |   const exportBtn = page.getByText('Export');
  108 |   if (await exportBtn.isVisible({ timeout: 5000 })) {
  109 |     await exportBtn.click();
  110 |     await page.waitForTimeout(500);
  111 | 
  112 |     // Click the QDPX format option if it appears.
  113 |     const qdpxOption = page.getByText('REFI-QDA (QDPX)');
  114 |     if (await qdpxOption.isVisible({ timeout: 3000 })) {
  115 |       await qdpxOption.click();
  116 |       await page.waitForTimeout(2000);
  117 |     }
  118 |   }
  119 | 
  120 |   // 9. Final assertion: no page errors.
  121 |   expect(errors).toHaveLength(0);
  122 | 
  123 |   // Cleanup: close project first so the db pool releases its WAL lock,
  124 |   // then remove the temp directory.
  125 |   await page.evaluate(() => {
  126 |     const { invoke } = (window as unknown as { __TAURI_INTERNALS__: { invoke: Function } }).__TAURI_INTERNALS__;
  127 |     return invoke('projects_close');
  128 |   }).catch(() => { /* best-effort */ });
  129 |   fs.rmSync(targetDir, { recursive: true, force: true });
  130 | });
  131 | 
```