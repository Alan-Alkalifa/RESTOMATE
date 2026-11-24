# BUG-008: the e2e web server needs EMAIL_FROM and silently depends on the environment it is started from

| | |
|---|---|
| Task ID | MF-T36 (QA test base: `apps/web/playwright.config.ts`, QA's own file) |
| PR / commit | `main` at `ac9824a`; found by CI run 45357131692 (re-run), reproduced locally |
| Severity | S2 in CI: the onboarding journey fails on desktop and tablet in CI, so the E2E job is red. The app is correct; the test environment was incomplete |
| Owner | DAVIN |
| Found by / date | ALAN from CI, reproduced by DAVIN, 2026-11-24 |

## Steps
1. Start the e2e web server without `EMAIL_FROM` in the environment (as in CI), run `pnpm test:e2e onboarding-journey`.
2. Watch the step "Invitation sent." and the server log.

## Expected
The journey passes, as it does on a machine that has `EMAIL_FROM` set.

## Actual
"Invitation sent." never appears. The server logs `{"event":"email","kind":"staff_invitation","outcome":"failed","error":"not_configured"}`: `getEmailEnv()` requires `EMAIL_FROM` and `EMAIL_DELIVERY` even in `log` mode (`lib/env.ts`, `getEmailEnv`), so the send reports not configured, `emailSent` is false, and the UI rightly does not claim the invitation was sent.
Why QA never saw it: the QA sandbox has `EMAIL_FROM` set as an app variable, so every local run passed.

## Evidence
- Reproduced before the fix, clean environment (`env -u EMAIL_FROM …`): journey fails on desktop at `getByText('Invitation sent.')`, with the `not_configured` log line above.
- After the fix, same clean environment: journey passes on desktop (1.1 min) and tablet (41.8 s).

## The fix, and the audit it came with
`apps/web/playwright.config.ts`: the web server's `env` now pins every variable the app reads (`lib/env.ts`), so it never depends on ambient values:
- `EMAIL_DELIVERY=log` and `EMAIL_FROM="Restomate QA <qa@example.com>"`;
- blank (the app treats blank as unset): `ARCJET_KEY`, `RESEND_API_KEY`, `DOKU_ENV`, `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the app prefers a publishable key over the anon key, so a stray one would override the local anon key);
- left to the caller on purpose, because they point at the stack under test: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (CI exports them from `supabase status`).

Audit of the QA sandbox environment (names only): besides `EMAIL_FROM`, it also sets `DOKU_ENV`, `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ARCJET_KEY`, `RESEND_API_KEY`, `EMAIL_DELIVERY`. Before this fix only `ARCJET_KEY`, `RESEND_API_KEY` and `EMAIL_DELIVERY` were pinned.

## Not verified
- **PostHog.** Local e2e runs before this fix inherited `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` from the sandbox, so analytics events for test users may have been sent to that project. I did not check the PostHog project or whether the sandbox network reached it. CI never had those variables.
- CI itself on this change (the fix is verified locally in a clean environment).

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
| 2026-11-24 | this PR | PASS locally in a clean environment: journey on desktop and tablet | onboarding journey only; CI run pending |
