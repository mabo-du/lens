import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the LENS FE E2E suite.
 *
 * The fixture (`tests/e2e/fixture/`) is bundled by a dedicated vite config
 * (`fixture.vite.config.ts`) on a separate port (57599) so it doesn't
 * collide with the main app's Tauri dev server (57598, strictPort).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: __dirname,
  testMatch: ['**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:57599',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Round-78 REPLACE Playwright's webServer mechanism entirely with
  // globalSetup + globalTeardown. The webServer lifecycle was racy with
  // vite preview cold-start on Linux (3 attempts: vite dev / build &&
  // preview-and-IPv4 / build && preview all failed with ERR_CONNECTION_REFUSED
  // despite vite booting cleanly when invoked manually). The globalSetup
  // spawns `npx vite preview` directly + polls 127.0.0.1:57599 with a
  // deterministic timeout, removing the lifecycle race.
  //
  // Round-83 NOTE: paths MUST be absolute and derived from this config
  // file's own dir. Earlier the values were "./tests/e2e/global-setup.mjs"
  // which Playwright resolves against the importing CLI's location
  // (node_modules/playwright/lib/common/index.js) — not the config file.
  // That produced "Cannot find module './tests/e2e/global-setup.mjs'"
  // (MODULE_NOT_FOUND, code 'MODULE_NOT_FOUND') on every CI run.
  // Using fileURLToPath + __dirname yields reproducible absolute paths.
  globalSetup: path.join(__dirname, 'global-setup.mjs'),
  globalTeardown: path.join(__dirname, 'global-teardown.mjs'),
});
