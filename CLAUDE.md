# Restomate — Engineering rules

Multi-tenant restaurant SaaS: POS, kitchen display, tables, customer ordering site, payments.
What we build: `docs/PROJECT.md`. Task list and order: `docs/PLAN.md`. Look and feel: `docs/DESIGN.md`. Staging: `docs/STAGING.md`.
Who does what: `docs/PLAN.md` §1.1 and `.jsmhq-role.md`. One phase and one step is active at a time.

## Stack

- Next.js 16 (App Router, Cache Components), React, TypeScript 5.x, Tailwind v4, Plus Jakarta Sans
- Supabase (Postgres, Auth, Realtime, Storage), `@supabase/ssr`
- DOKU (payments), Resend (email), Arcjet (abuse protection), PostHog (analytics, errors)
- pnpm + Turborepo, Zod, Vitest (unit), pgTAP (database), Playwright (e2e), GitHub Actions, Vercel

Before writing integration code, use the installed skills (`supabase`, `arcjet`, PostHog, Next.js docs in `node_modules/next/dist/docs/`) and follow current docs, not memory.

## Layout

```
apps/web/                 Next.js app
  app/                    pages, layouts (REYKI); route handlers and Server Actions (ADIT or CARLO, by module)
  components/             UI (REYKI)
  lib/                    server logic (ADIT or CARLO, by module); env, money, access layer, email (CARLO)
  proxy.ts                host routing, session refresh, Arcjet (CARLO)
  AGENTS.md               stays committed
packages/db/              generated database types (never edit by hand)
supabase/                 config, migrations, seed.sql, seed-staging.sql, templates/, tests/ (pgTAP)
docs/                     PROJECT, PLAN, DESIGN, STAGING, contracts/, qa/
.github/workflows/        CI and deploy (ADIT)
```

## Rules (full list: `docs/PLAN.md` §2)

- `proxy.ts` is for host routing, session refresh and Arcjet only. **Never authorization.**
- Authorization happens on the server on every action (`requirePermission`) and in the database (RLS). Never trust the client.
- Cache Components on. No `cookies()`/`headers()` outside `<Suspense>`. Session lookups `'use cache: private'`; derived data `'use cache'` keyed by user or org ID with `cacheTag`, refreshed with `updateTag`. `instant = false` is a last resort, logged in PLAN §14.
- Database: text + `check` instead of enums; `created_at`/`updated_at`; RLS on every table; `(select auth.uid())` in policies; helpers in `private` schema; security-definer functions use `search_path = ''`. Migrations are forward-only and compatible with the previous app version. No API role (`anon`, `authenticated`, `service_role`) gets privileges by default: each migration grants only what each role needs (baseline: M0-BE-29).
- Money: integers in the smallest unit (IDR exponent 0), rates in basis points, totals computed on the server by `lib/money`.
- Orders and bills snapshot names, prices and rates.
- Realtime channels are per location and authorized; refetch after reconnect.
- One Zod schema shared by client and server. Every action returns one `ActionResult` shape.
- Every screen: loading, empty, error, offline (where live); English and Bahasa Indonesia; follows `DESIGN.md`. No hard-coded text.
- No secret in the repo. No personal data in logs, analytics, cache keys or tags. Never print an env value, only its name.
- One task = one branch = one draft PR. Touch only the files the task lists and you own. Lint, typecheck, unit tests and build must be green.

## App surfaces

| Surface | Host | Who | Guard |
|---|---|---|---|
| Frontend (signup, marketing) | root domain (`NEXT_PUBLIC_ROOT_DOMAIN`) | public | none; signed-in users skip auth pages |
| Restaurant admin | app host (`NEXT_PUBLIC_APP_URL`), `/app/...` | org members | `requireUser` + `getOrgContext` + `requirePermission`; suspended org or deactivated member gets no access |
| Super admin | app host, `/admin/...` | platform admins | `requirePlatformAdmin`; `platform_admins` has no client access |
| Customer site | `<slug>.<root domain>` | guests | public read through `get_storefront`; unknown host returns 404; suspended notice for suspended orgs |

On Vercel preview deployments only, the deployment's own `VERCEL_URL` / `VERCEL_BRANCH_URL` hosts are served as the app host (see STAGING.md).

## Environment variables (names only; full table in `docs/STAGING.md`)

`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (server only), `ARCJET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DELIVERY` (`log` locally, `resend` required in production), `DOKU_ENV` (`sandbox` until M5 approval), `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.

Validated by `lib/env.ts` (Zod). A bad variable fails with its name and never its value. Provide `.env.example` with names and empty values.

## Email (Resend)

- All email goes through the `lib/email` wrapper: one recipient per send, an idempotency key, `log` mode locally, failures logged and retryable.
- Local: Supabase Auth mail goes to Mailpit. Hosted: Supabase Auth SMTP uses Resend (`smtp.resend.com`, port 465, user `resend`, password = the Resend API key, sender on the verified sending subdomain). Set it in the dashboard; never commit the key.
- Auth email links use `token_hash` and `/auth/confirm`. Templates live in `supabase/templates/`; the hosted project needs them pasted in by hand.
- Needs SPF, DKIM, DMARC on the sending subdomain before production.

## Approval needed from the project owner

Production changes, real payments, platform-admin inserts, pricing, legal text, public launch. Ask through the lead.
