# Test plan

Scope grows by milestone. This file is the map; per-milestone evidence goes in `docs/qa/<milestone>-signoff.md`.

## Targets

| Surface | Target | How |
|---|---|---|
| Admin and POS | 10" tablet (about 1280x800), desktop | Playwright projects `desktop` and `tablet`, touch targets 44 px or more |
| Kitchen display | kitchen screen (landscape, large) | from M3 |
| Customer site | mid-range phone on 4G | from M4 (Lighthouse, throttled) |
| Database | local Supabase (`supabase start`) | pgTAP, run as `anon`, `authenticated` and `service_role` |

## Layers

1. **pgTAP** (`supabase/tests/*.test.sql`): schema, grants, RLS, RPCs, guards. One file per migration area. Each runs in a transaction and rolls back.
2. **Playwright** (`apps/web/e2e/**/*.e2e.ts`): user journeys against `next dev`/`next start` plus the local stack and Mailpit. Files end in `.e2e.ts` so Vitest never collects them.
3. **Manual / exploratory**: only for what automation cannot see (real devices, visual polish). Recorded in the report with screenshots.

## Always-on checks

- **Tenant isolation**: every new table gets select, insert, update, delete attempts from another tenant, and from `anon`. Every one must fail.
- **Privilege baseline**: a new object is unreachable until a migration grants it (`privilege_baseline.test.sql`).
- **Permissions per role**: Owner, Manager, Cashier, Waiter, Kitchen, plus a custom role.
- **Abuse**: escalation, last owner, plan limits, reused/expired/wrong-email invites, slug rules, rate limits.
- **Accessibility and motion**: keyboard path, labels, `prefers-reduced-motion` (DESIGN 4.5).

## M0 (Foundation)

| ID | Task | Proves |
|---|---|---|
| M0-QA-01 | Test base | both suites run in CI |
| M0-QA-02 | Isolation | every cross-tenant select/insert/update/delete fails, per table |
| M0-QA-03 | Abuse | each abuse case is refused |
| M0-QA-04 | End to end | signup, confirm, create restaurant, invite Cashier, accept, deactivate, on desktop and tablet |
| M0-QA-05 | Sign-off | evidence for 4.9.1, 4.9.2, 4.9.3, 4.9.6 |

Extra M0 checks from the frontend handoff: emails end to end through Mailpit; wrong-email invite and generic bad-link page; the marketing-only motion bundle (gsap, lenis); reduced motion; the `/s/[slug]` placeholder and suspended notice.

## Environments

Local only for functional QA. Previews are used to look at the frontend when Vercel allows them. DOKU sandbox from M5; production only for the one approved low-value transaction.
