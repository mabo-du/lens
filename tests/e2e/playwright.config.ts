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
    baseURL: 'http://localhost:57599',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --config tests/e2e/fixture.vite.config.ts',
    url: 'http://localhost:57599',
    // Always reuse an existing server so re-runs while iterating on tests
    // don't fight vite's HMR restart on port 57599. In CI we can still
    // assume a fresh server; the CI image doesn't have one running.
    reuseExistingServer: true,
    // Cold-start of vite + React transform + Konva compile on first run
    // is closer to 25–35 s on Linux; bump timeout to absorb that and
    // avoid the "Cannot navigate to invalid URL" race where playwright
    // starts navigating before the server is ready.
    timeout: 60_000,
  },
});
