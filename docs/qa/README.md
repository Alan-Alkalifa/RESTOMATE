# QA

Owner: DAVIN. Everything QA produces lives here; tests live in `supabase/tests/**` (pgTAP) and `apps/web/e2e/**` (Playwright).

| File | What it is |
|---|---|
| `test-plan.md` | What is tested per milestone, on which targets, with which tools |
| `bug-template.md` | Copy for every bug. One bug names one task ID, so ALAN can route it to one owner |
| `report-template.md` | Copy for every PASS/FAIL report. Nothing passes without evidence |
| `bugs/` | One file per bug (BUG-001, BUG-003, BUG-004; BUG-002 was not needed) |
| `M0-isolation-report.md`, `M0-abuse-report.md` | Reports for M0-QA-02 and M0-QA-03 |
| `M0-signoff.md` | M0 sign-off (created by M0-QA-05) |

## Running the suites

| Suite | Command | Needs |
|---|---|---|
| pgTAP | `pnpm db:start && pnpm db:reset && pnpm db:test` | Docker, about 6 GB RAM |
| Playwright | `pnpm db:start && pnpm db:reset`, export the local keys (see `.github/workflows/ci.yml`, job E2E), then `pnpm test:e2e:install && pnpm test:e2e` | the same stack, plus browsers |

After `db:reset` the CLI does not wait for Auth, Storage or Realtime. Tests that use them wait for health first (`apps/web/e2e/support/wait-for-stack.ts`; pgTAP does not need it).
After a change to `supabase/config.toml` (email templates, auth settings) restart the stack (`pnpm db:stop`, then `pnpm db:start`): `db:reset` does not reload Auth, which keeps serving the old templates (found in M0-QA-04: mail arrived with the default link instead of `/auth/confirm`). On a machine with about 6 GB, `pnpm exec supabase start -x studio,imgproxy` avoids the Studio health-check timeout.
CI runs both on every PR that changes `supabase/`, `apps/`, `packages/` or build config.

## Rules (from the QA role)

- Test tenant isolation on every new table and permissions for every role.
- DOKU sandbox and test data only. Never production.
- A bug names the task ID, a severity (S1 worst to S4), steps, expected, actual and evidence.
- PASS needs no open S1 or S2. After a fix: retest the bug and regress what it touches.
- QA never fixes product code and never merges.
