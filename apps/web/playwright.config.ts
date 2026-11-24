import { defineConfig, devices } from "@playwright/test";

// M0-QA-01. Browser tests run against `next dev` and the local Supabase stack (`pnpm db:start`).
// Specs end in `.e2e.ts`, never `.spec.ts`, so Vitest does not collect them.
// CI exports the local keys (see the E2E job). Locally: `pnpm db:status` prints them.

// `lib/actions/staff/email.ts` is `server-only`. The react-server condition makes that import a no-op, so a spec
// can run the real `acceptInvitationUrl()`. It is set for the test workers only: the web server below gets the
// original NODE_OPTIONS back, because `next dev` must not run with it.
const ORIGINAL_NODE_OPTIONS = process.env.NODE_OPTIONS ?? "";
process.env.NODE_OPTIONS = `${ORIGINAL_NODE_OPTIONS} --conditions=react-server`.trim();

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./test-results",
  // One Supabase stack and one Mailpit inbox: journeys that read mail must not overlap.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  globalSetup: "./e2e/support/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Admin on a laptop or desktop.
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    // 10" tablet in landscape (POS and admin target), touch.
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
        isMobile: false,
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        // The test server never depends on the environment it is started from (BUG-008). Every variable the app
        // reads (lib/env.ts) is pinned here, except the ones the caller must provide for the stack under test:
        // NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_ROOT_DOMAIN, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
        // and SUPABASE_SERVICE_ROLE_KEY (CI exports them from `supabase status`).
        //  - Mail is only logged. The app still insists on a sender in log mode, so a fixed one is given: without
        //    it "Invitation sent." never shows (the send reports `not_configured`), and a developer machine that
        //    happens to have EMAIL_FROM would pass where CI fails.
        //  - No key means Arcjet fails open and Resend is never called.
        //  - Payments, encryption and analytics are blank, so no real service or project is ever contacted and no
        //    test user reaches PostHog.
        //  - The app prefers a publishable key over the anon key; blank it so only the caller's anon key is used.
        env: {
          EMAIL_DELIVERY: "log",
          EMAIL_FROM: "Restomate QA <qa@example.com>",
          ARCJET_KEY: "",
          RESEND_API_KEY: "",
          DOKU_ENV: "",
          DOKU_CLIENT_ID: "",
          DOKU_SECRET_KEY: "",
          APP_ENCRYPTION_KEY: "",
          NEXT_PUBLIC_POSTHOG_KEY: "",
          NEXT_PUBLIC_POSTHOG_HOST: "",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
          NODE_OPTIONS: ORIGINAL_NODE_OPTIONS,
        },
        stdout: "ignore",
        stderr: "pipe",
      },
});
