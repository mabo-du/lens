import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * LENS E2E test configuration. Matches the `playwright-e2e` job in
 * `.github/workflows/ci.yml`.
 *
 * The CI job runs:
 *   cd e2e && npx playwright install --with-deps chromium && npx playwright test
 *
 * The app must be built first (`cargo build && npm run build`) and a
 * localhost:57598 dev server running (`http://localhost:57598`).
 */
export default defineConfig({
  testDir: './',
  timeout: 60_000,
  retries: CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:57598',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Only run locally when explicitly invoked (`npx playwright test`),
  // not as part of vitest.
  // CI detection: `CI` is set by GitHub Actions.
});
