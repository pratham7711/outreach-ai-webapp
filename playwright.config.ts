import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

/* The Playwright runner is a plain Node process: unlike `next dev` it does not
   read .env.local, so NEXTAUTH_SECRET was absent and e2e/fixtures/auth.setup.ts
   silently fell back to its hardcoded default. That minted session cookies the
   server could not decrypt -- JWTSessionError on every authenticated spec, for
   a reason that looked nothing like a missing env var. Load it the way Next
   itself does, before defineConfig reads anything. */
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // sequential to avoid auth race conditions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 120000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3009',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /* No video, deliberately. Recording is the one feature that needs
       Playwright's BUNDLED ffmpeg helper, and every project below sets
       channel: 'chrome' precisely so this suite runs against system Chrome with
       no managed download at all -- so asking for a managed binary contradicts
       the choice the rest of the file makes. It failed loudly rather than
       degrading: browserContext.newPage() threw "Executable doesn't exist at
       ms-playwright/ffmpeg-1011/ffmpeg-mac" for every spec that opens a page,
       ~120ms each, which read as 130 broken specs instead of one missing
       binary. Traces embed screenshots and screenshot:'only-on-failure'
       remains, so failure diagnostics are unchanged. */
    actionTimeout: 30000,
    navigationTimeout: 60000,
  },
  projects: [
    // Admin auth setup: generate JWT and save storage state
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      testIgnore: /portal-auth\.setup\.ts/,
    },
    // Portal auth setup: login via API and save session cookie
    {
      name: 'portal-setup',
      testMatch: /portal-auth\.setup\.ts/,
    },
    // Authenticated admin tests: reuse saved session
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: 'e2e/fixtures/.auth.json',
      },
      dependencies: ['setup'],
      testIgnore: [/auth\.spec\.ts/, /portal-.*\.spec\.ts/],
    },
    // Unauthenticated tests: fresh browser, no session
    {
      name: 'chrome-noauth',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      testMatch: [/auth\.spec\.ts/, /portal-auth\.spec\.ts/],
    },
    // Portal authenticated tests: creator session
    {
      name: 'chrome-portal',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: 'e2e/fixtures/.portal-auth.json',
      },
      dependencies: ['portal-setup'],
      testMatch: /portal-(?!auth).*\.spec\.ts/,
    },
  ],
  webServer: {
    /* next dev binds 3000, which Leegality owns on this machine, while the url
       below waits on 3009 -- so webServer could never start on its own and a
       hand-started server was the only path that ever worked. */
    command: 'PORT=3009 npm run dev',
    url: process.env.E2E_BASE_URL || 'http://localhost:3009',
    /* The suite asserts on seed fixtures -- 'LEAK IT', creator@demo.com and the
       rest -- so it needs the seeded branch, not whatever .env.local happens to
       point at. That default was a snapshot branch of the prod project holding
       512 real campaigns and no seed rows, which is why every seed-dependent
       spec failed while 54 others passed: not flakiness, the wrong database. */
    env: process.env.TEST_DATABASE_URL
      ? { DATABASE_URL: process.env.TEST_DATABASE_URL }
      : undefined,
    /* Reuse is a trap once the database matters: a server already up on 3009 is
       almost certainly pointed at the dev database, and reusing it would silently
       run the suite against the wrong data again. */
    reuseExistingServer: !process.env.TEST_DATABASE_URL,
  },
});
