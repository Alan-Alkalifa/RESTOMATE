# BUG-007: the CI E2E job never gets past "Install browsers" and is cancelled by the 15-minute job timeout

| | |
|---|---|
| Task ID | MF-T02 (M0-BE-02 CI: `.github/workflows/ci.yml` job E2E and the root `test:e2e:install` script); it blocks MF-T36's "both suites run in CI" |
| PR / commit | #70 (`b8ed395`, run 45343190565) and #74 (`bf46516`, run 45347889987) |
| Severity | S2: the Playwright suite cannot run in CI at all, so none of the e2e evidence is gated; pgTAP is (job Database passes) |
| Owner (PLAN 1.1) | ADIT (CI). The root `package.json` and `ci.yml` are outside QA's files |
| Found by / date | DAVIN / 2026-11-24 |

## Steps
1. Open the E2E job of the CI run on #70 or #74.
2. Read the step log around "Install browsers" (`pnpm run test:e2e:install` = `pnpm --dir apps/web exec playwright install --with-deps`).

## Expected
Browsers install in a minute or two and the suite runs.

## Actual
#70: the install command starts at 06:51:29 and the job is cancelled at 07:05:11 (`##[error]The operation was canceled.`), 15m16s in total. #74: the step starts about 07:27 and is cancelled at 07:42. Nothing is printed in between. The job's `timeout-minutes` is 15, and that includes dependency install and `supabase start`.

## Evidence
`gh pr checks 70` and `gh pr checks 74`: Check pass, Database pass, **E2E fail 15m16s** on both. Log lines quoted above (`gh run view --job 138272028444 --log`, `--job 138287372466 --log`).
Not known: why it hangs (the log is silent). Candidates: the apt step of `--with-deps` or a stalled browser download; the command installs Chromium, Firefox and WebKit, while `apps/web/playwright.config.ts` uses Chromium only.

## Suggested direction (ADIT decides)
- `test:e2e:install`: `playwright install --with-deps chromium` (one browser, fewer system packages).
- A `timeout-minutes` on that step (for example 8) so a hang fails fast and says where.
- Cache `~/.cache/ms-playwright` keyed by the Playwright version.
- Raise the E2E job timeout (suite about 6.5 minutes locally on a warm machine, plus `supabase start` and a cold `next dev`), or run the suite against `next build && next start`.
- Expect the job to go red on BUG-006 (2 tests, marketing reduced motion) until REYKI fixes it.

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
