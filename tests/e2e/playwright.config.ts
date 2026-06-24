import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the LENS FE E2E suite.
 *
 * The fixture (`tests/e2e/fixture/`) is bundled by a dedicated vite config
 * (`fixture.vite.config.ts`) on a separate port (57599) so it doesn't
 * collide with the main app's Tauri dev server (57598, strictPort).
 */
export default defineConfig({
  testDir: './tests/e2e',
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
  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',
});
