// playwright.config.ts
// Smoke tests run against a locally-served copy of the static site
// (npx serve -l 3000 .). Targets only PUBLIC surfaces — lock screen
// and intake forms — so no Supabase session seeding is required.
// Authenticated flows (login → client → viewing) need a seeded test
// agent and live in a separate config (PR #6b, future).

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // CI starts the server before invoking Playwright; locally we let
  // Playwright start it for us.
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npx --yes serve -l 3000 .',
        port: 3000,
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
