# PLAN.md — Restomate implementation plan

> **How to use this file.** This is the working build plan. Tick a box only when the work is merged and verified, and add a line to the *Decisions log* (§14) whenever a choice is made.
> - **What** we build and why → `PROJECT.md`
> - **How** we build it (stack, rules, conventions) → `CLAUDE.md` (created in M0-LD-02)
> - **How it looks and feels** → `DESIGN.md`
> - **In what order, by whom, and what's done** → this file

Last updated: 2026-11-22. **The project restarts from zero: nothing below is done.** Task IDs and PR numbers from before this date are retired.

---

## 1. Status snapshot

| Phase | State | Active step | QA verdict | Closed on |
|---|---|---|---|---|
| M0 Foundation | Active | 2. Backend (ADIT, CARLO) | — | — |
| M1 Signup and super admin | Not started | — | — | — |
| M2 Venue and menu | Not started | — | — | — |
| M3 Service core (MVP) | Not started | — | — | — |
| M4 Customer site | Not started | — | — | — |
| M5 Payments (DOKU) | Not started | — | — | — |
| M6 Launch | Not started | — | — | — |
| M7 After launch | Not started | — | — | — |

### 1.1 Team

| Person | Role | Task code | Owns |
|---|---|---|---|
| **ALAN** | Lead | `LD`, `CL` | Product and planning docs, `CLAUDE.md`, scope, review, merge, sign-off. Writes no app code |
| **ADIT** | Backend developer | `BE` tasks marked ADIT | `supabase/config.toml`, `supabase/seed*.sql`, M0 migrations. CI and deploy workflows in `.github/workflows/**`, root configuration. Modules, with their migrations, `lib` code, actions and routes: platform admin (tenants, packages, settings), locations, areas, tables, QR, stations, orders, kitchen, guest order intake, opening hours, reservations, reports, schedules, PIN. Contracts for those modules in `docs/contracts/` |
| **CARLO** | Backend developer | `BE` tasks marked CARLO | `apps/web/proxy.ts`, `apps/web/next.config.ts`, `apps/web/instrumentation.ts`, `apps/web/lib/env.ts`, `.env.example`. `apps/web/lib/{supabase,auth,analytics,email,money}/**`, `apps/web/lib/arcjet.ts` (email templates are REYKI's). Modules, with their migrations after M0, `lib` code, actions and routes: auth, organization, staff, roles, onboarding, menu, bills, payments, printing, storefront, table requests, DOKU, customers, theme data, subscription billing. Contracts for those modules in `docs/contracts/` |
| **REYKI** | Frontend developer | `FE` | `apps/web/app/**` pages and layouts, `apps/web/components/**`, `globals.css`, `lib/theme.ts`, client providers and hooks, email markup, `supabase/templates/**`, translations |
| **DAVIN** | QA | `QA` | `supabase/tests/**`, Playwright suites and config, `docs/qa/**` |

**Backend split:**

- A task has one owner. Work only on tasks with your name. Never pick up, finish or fix the other backend developer's task.
- Never edit the other's files, migrations or module tables. A change to a table created in M0 is always an ADIT task. Ask ALAN to give that change to its owner. You may call their code through its contract.
- Each migration is a new timestamped file made by the task's owner. Never edit another migration.
- Only two files are shared, and only by command: generated types in `packages/db` (`pnpm db:types`) and dependencies (`pnpm add`, which updates `package.json` and the lockfile). Never hand-merge either: rebase, then run the command again.
- If your task needs one of the other's tasks, wait until it is merged or ALAN gives you its branch to stack on.

The more specific path wins. Unit tests belong to whoever owns the code they test.

### 1.2 How work moves

One phase is active at a time, and one step inside it.

| Step | Owner | Starts when | Hands off when |
|---|---|---|---|
| 1. Plan | ALAN | The previous phase is closed | Every `LD` task is done |
| 2. Backend | ADIT and CARLO, by task | Plan is handed off | Every `BE` task has a green draft PR and a contract in `docs/contracts/` |
| 3. Frontend | REYKI | Backend is handed off | Every `FE` task has a green draft PR, stacked on the backend |
| 4. QA | DAVIN | Frontend is handed off | Every acceptance line has evidence and a PASS, with no open S1 or S2 bug |
| 5. Close | ALAN | QA is handed off | PRs are merged, boxes are ticked, the phase is closed |

- **Order:** each person does their tasks top to bottom. A task may rely on any task above it, never on one below it.
- **One task = one branch = one draft PR.** ALAN marks it ready only after DAVIN's PASS and ALAN's own review, then squash-merges one at a time in stack order. Retarget stacked PRs to `main` before deleting a branch. Markdown-only PRs skip QA.
- **Second task:** ALAN may give ADIT or CARLO one more task while their current one is blocked, parked, or pushed and waiting for QA or merge. They work on one at a time, on separate branches and files, with the same QA and review before each merge.
- **Failed QA:** DAVIN files the bug and ALAN reopens step 2 or 3. The fix passes through the remaining steps again.
- **Bug in a closed phase:** S1 or S2 pauses the current step until it is fixed and verified. S3 and S4 go into the next Plan step.
- **Severity:** S1 data leak, money error or outage. S2 a main flow is broken. S3 broken with a workaround. S4 cosmetic.
- **Project owner approval, each time:** production changes, real payments, platform-admin inserts, pricing, legal text, public launch.

### 1.3 Every task is done only when

- [ ] Lint, typecheck, unit tests and build are green.
- [ ] A new table has RLS, and the server checks permission on every action.
- [ ] A new screen has loading, empty, error and (where live) offline states, text in English and Bahasa Indonesia, and follows `DESIGN.md`.
- [ ] No secret is in the repo, and no personal data is in logs, analytics, cache keys or tags.

These four lines are a template. Check them on each PR and leave them unticked here.

---

## 2. Technical rules

Confirm these against the installed Next.js docs (`node_modules/next/dist/docs/`) in M0-BE-01.

- **`proxy.ts` replaces `middleware.ts`.** Use it only for host routing, session refresh and Arcjet, never for authorization.
- **Cache Components are enabled explicitly** (`cacheComponents: true`, `partialPrefetching: true`).
  - Reading `cookies()` or `headers()` outside `<Suspense>` is a build error.
  - Layouts don't await the session or dynamic `params` at the top level.
  - Session lookups use `'use cache: private'`. Derived data uses `'use cache'` keyed by user or org ID with `cacheTag`, refreshed with `updateTag`.
  - `export const instant = false` is a last resort. Record each use in §14.
- **`AGENTS.md` in `apps/web` stays committed.** TypeScript stays on 5.x.
- **Database:** text columns with `check` constraints instead of enums, `created_at` and `updated_at`, RLS on every table, `(select auth.uid())` in policies, internal helpers in a `private` schema, security-definer functions with `search_path = ''`. No API role (`anon`, `authenticated`, `service_role`) gets privileges by default: each migration grants only what each role needs (baseline: M0-BE-29).
- **Migrations are forward-only** and work with the previous app version.
- **Money:** integers in the currency's smallest unit (IDR exponent 0), rates in basis points, totals calculated on the server by `lib/money`.
- **History is a snapshot:** orders and bills store names, prices and rates as they were.
- **Realtime:** channels are scoped per location and authorized. Clients refetch after a reconnect.
- **Validation:** the same Zod schema on client and server.

---

## 3. Milestone overview

| Milestone | Goal | Starts after | Size | PROJECT.md |
|---|---|---|---|---|
| **M0 Foundation** | Sign up, create a restaurant, invite staff with a role | — | L | §4.9, §8 |
| **M1 Signup and super admin** | Public site, full onboarding, tenants, packages | M0 closed | M | §5.1, §5.2, §6 |
| **M2 Venue and menu** | Locations, areas, tables, floor plan, menu, QR codes | M1 closed | L | §4.1, §4.7, §4.10, §4.11 |
| **M3 Service core (MVP)** | POS, orders, KDS, bills, printing, payment tracking | M2 closed | XL | §4.2, §4.4, §4.5, §4.12, §4.13 |
| **M4 Customer site** | Branded site, QR ordering, online pickup | M3 closed | L | §4.7, §4.15 |
| **M5 Payments (DOKU)** | Online and at-table payment, refunds, reconciliation | M4 closed | L | §4.8, §4.13 |
| **M6 Launch** | Reservations, customers, reports, schedules, theming, billing | M5 closed | XL | §4.3, §4.6, §4.14, §4.16, §5.1 |
| **M7 After launch** | Backlog, one item at a time | M6 closed | — | §4.14, §4.15, §9 |

No milestones run in parallel.

Acceptance lines carry their `PROJECT.md` number: `4.1.3` is the third criterion of §4.1, and `4.1.US2` is its second user story.

---

## 4. M0 — Foundation

**Exit:** a user signs up, confirms their email and creates a restaurant with one location. They invite a Cashier, who accepts and sees only what a cashier may see. Another restaurant can read none of it.

### 4.1 Plan — ALAN

- [x] **M0-LD-01 Starting point.** Confirm with the project owner what happens to any earlier code, branches, Vercel project and staging database. *Done when:* each is marked keep, reset or replace in §14, and nothing was deleted without approval.
- [x] **M0-LD-02 Engineering rules.** Write `CLAUDE.md`: stack, layout tree, §2 rules, surfaces and routing, environment variables, email. *Done when:* every `CLAUDE.md` reference in the docs resolves.
- [x] **M0-LD-03 Access.** Arrange repository, Vercel, Supabase, Resend, Arcjet, PostHog and DOKU sandbox access. *Done when:* each service is reachable and no secret is in a file.
- [x] **M0-LD-04 Board.** Copy the M0 tasks to the HQ board with their IDs, owners and order. *Done when:* every task has one owner.

### 4.2 Backend — ADIT and CARLO

**Project setup**
- [x] **M0-BE-01 Monorepo.** _(ADIT)_ pnpm and Turborepo, Next.js 16 in `apps/web`, TypeScript 5.x, ESLint, Prettier, scripts `dev`, `build`, `lint`, `typecheck`, `test`, `db:*`. *Done when:* all scripts run on a clean clone and §2 is confirmed.
- [x] **M0-BE-02 CI.** _(ADIT)_ GitHub Actions: install, lint, typecheck, unit, build, database reset and pgTAP, plus an e2e job ready for DAVIN's suite. *Done when:* a draft PR gets a result from each job.
- [x] **M0-BE-03 Supabase.** _(ADIT)_ Local config, auth settings, Mailpit, Resend SMTP block. *Done when:* `supabase start` and `db reset` work from zero.
- [x] **M0-BE-26 Turbo build env.** _(ADIT)_ `turbo.json` declares the server variables on the build task. Merges before M0-BE-04. *Done when:* with M0-BE-04 applied, a root build with `VERCEL=1` passes on valid values and fails by name when one is missing.
- [x] **M0-BE-27 Turbo dev env.** _(ADIT)_ `turbo.json` passes the 9 server variables through to the dev task. *Done when:* `pnpm dev` sees them from the shell and undeclared names stay hidden.
- [x] **M0-BE-28 core-js build decision.** _(ADIT)_ `core-js: false` under `allowBuilds`. Merges before M0-BE-17. *Done when:* a frozen install passes with `posthog-js` added.
- [x] **M0-BE-04 Environment.** _(CARLO)_ `lib/env.ts` with Zod, `.env.example`, publishable key with anon-key fallback, `EMAIL_DELIVERY=resend` required in production, build and boot checks. *Done when:* a bad variable fails with its name and never its value.

**Database**
- [x] **M0-BE-29 Privilege baseline.** _(ADIT)_ First migration: no default privileges for API roles or `PUBLIC` on new objects in `public`. Merges before M0-BE-05. *Done when:* a new table, view, sequence and function are unreachable until granted, from local and hosted starting defaults.
- [x] **M0-BE-05 Identity tables.** _(ADIT)_ `profiles` (synced from `auth.users`), `platform_admins` (service role only), `platform_settings` (deny by default), `audit_logs`. *Done when:* a client can't write admin, settings or audit rows.
- [x] **M0-BE-06 Tenancy tables.** _(ADIT)_ `organizations` (unique slug of 3–40 characters, status, currency, timezone), `reserved_slugs`, `locations` (address, timezone, currency, tax and service-charge bps, tax-on-service flag), `org_branding` (https-only logo URL). *Done when:* constraints and RLS are in place.
- [x] **M0-BE-07 Packages.** _(ADIT)_ `packages` (prices, trial days, limits, features, active, public, default) and `subscriptions`. *Done when:* one default package gives a new restaurant a trial.
- [x] **M0-BE-08 Roles.** _(ADIT)_ `permissions`, `default_role_permissions`, `roles`, `role_permissions`, `organization_members`, `location_staff`, seeded from §4.2.1. *Done when:* the five system roles match that table.
- [x] **M0-BE-09 Invitations.** _(ADIT)_ `staff_invitations` with SHA-256 token hash, capped expiry, accepted and revoked times, explicit all-locations flag. *Done when:* no raw token is stored.
- [x] **M0-BE-10 Helpers.** _(ADIT)_ `is_platform_admin`, `is_org_member`, `has_permission` (fails closed), `has_location_access`, `my_permissions`, `get_org_package`, `my_org_membership`, `private.org_limit`, `private.write_audit`. *Done when:* a suspended org or deactivated member gets no access.
- [x] **M0-BE-11 Guards.** _(ADIT)_ Triggers for plan limits (`PLAN_LIMIT:<key>`), last owner, system-role protection, no self-escalation, no member delete, `updated_at`, audit. *Done when:* each forbidden write fails in the database.
- [x] **M0-BE-12 RPCs.** _(ADIT)_ `is_slug_available`, `create_organization` (one transaction, per-user cap), `accept_invitation` (email must match), `set_member_locations` (atomic), `get_storefront`. *Done when:* a failure leaves no partial rows.
- [x] **M0-BE-13 Seeds and types.** _(ADIT)_ Local seed (three packages, Demo Restaurant with two locations, a second tenant, one user per role, platform admin), staging seed without users, `packages/db` generated types. *Done when:* a reset gives the same data each time.

**App infrastructure**
- [x] **M0-BE-14 Clients and proxy.** _(CARLO)_ Supabase server, browser, proxy and server-only admin clients. `proxy.ts` resolves hosts, refreshes sessions, skips the DOKU webhook and serves Vercel preview hosts. *Done when:* an unknown host returns 404 and preview URLs open.
- [x] **M0-BE-15 Auth access layer.** _(CARLO)_ `getCurrentUser`, `requireUser`, `getMembership`, `getOrgContext`, `requirePermission`, `requirePlatformAdmin`, `hasFeature`. *Done when:* all server code has one way to check access.
- [x] **M0-BE-16 Abuse protection.** _(CARLO)_ Arcjet shield, bot detection, rate limits and a signup preset. *Done when:* repeated auth attempts are limited.
- [x] **M0-BE-17 Analytics and errors.** _(CARLO)_ PostHog capture, typed events, org grouping, error tracking, allow-listed query parameters, masked tokens, autocapture and recording off. *Done when:* no token or personal field leaves the app.
- [x] **M0-BE-18 Email sender.** _(CARLO)_ Resend wrapper with one recipient, idempotency key, log mode locally, failures logged and retryable. *Done when:* a failed send can be retried without a duplicate.
- [x] **M0-BE-19 Money.** _(CARLO)_ Formatting (`Rp 25.000`), tax and service-charge calculation. *Done when:* rounding has unit tests.

**Features**
- [x] **M0-BE-20 Auth actions.** _(CARLO)_ Login, signup, confirm by token hash, forgot and reset password, sign out, safe `next` redirect. *Done when:* all return one `ActionResult` shape and signed-in users skip the auth pages.
- [x] **M0-BE-21 Create restaurant.** _(CARLO)_ Slug check and create action on the RPC. *Done when:* the user lands in their organization as Owner.
- [x] **M0-BE-22 Staff actions.** _(CARLO)_ Invite, resend, revoke, accept, change role, set locations, deactivate with sign-out everywhere. *Done when:* every action is permission-checked and audited.
- [x] **M0-BE-23 Custom roles.** _(ADIT, moved from CARLO)_ Create, edit and delete roles from the permission list, gated by package. *Done when:* nobody can grant a permission they lack.
- [x] **M0-BE-24 Staging delivery.** _(ADIT)_ The database deploy workflow described in `STAGING.md`. *Done when:* the workflow's dry run passes. It applies only after merge.
- [x] **M0-BE-25 Contracts.** _(CARLO)_ Auth, organization, staff, roles. *Done when:* each lists inputs, outputs, errors and permissions.
- [x] **M0-BE-30 Staff and role RPCs.** _(ADIT)_ Definer RPCs for every staff and custom-role write, so the M0-BE-11 guards run as the caller (a `service_role` write has no `auth.uid()`). Deactivation ends the user's sessions in the same transaction. *Done when:* each requires `staff.manage` and runs the guards.
- [x] **M0-BE-31 Frontend reads and contract gaps.** _(CARLO)_ `listMyOrganizations`, `listMembers`, `listLocations`, `resendConfirmation`, `signOut({ next })`, the signup `next`, `previewInvitation`, and the contract additions REYKI asked for. *Done when:* REYKI can build M0-FE-04 to 08 from the contracts.
- [x] **M0-BE-32 Invitation preview RPC.** _(ADIT)_ `get_invitation_preview(token)` for anon: org, role and status, one identical answer for every unusable token. *Done when:* the invite page can show "Join X as Cashier" before accepting.

#### 4.2.1 Permission catalog

`menu.manage · orders.view · orders.create · orders.void · pos.use · pos.discount · kitchen.view · kitchen.update · tables.view · tables.manage · reservations.view · reservations.manage · bills.print · payments.view · payments.take · payments.refund · customers.view · customers.manage · reports.view · staff.manage · locations.manage · settings.manage · settings.branding · billing.manage`

| Role | Permissions |
|---|---|
| Owner | Everything (implicit, so new permissions never need backfilling) |
| Manager | Everything except `billing.manage`, `settings.manage`, `locations.manage` |
| Cashier | `pos.use, orders.view, orders.create, bills.print, payments.view, payments.take, customers.view, kitchen.view, tables.view` |
| Waiter | `pos.use, orders.view, orders.create, bills.print, kitchen.view, tables.view, reservations.view` |
| Kitchen | `kitchen.view, kitchen.update, orders.view` |

#### 4.2.2 M0 backend dependencies

| Task | Needs |
|---|---|
| M0-BE-05 | 03, 29 |
| M0-BE-06 | 05 |
| M0-BE-07 | 06 |
| M0-BE-08 | 06 |
| M0-BE-09 | 08 |
| M0-BE-10 | 07, 08 |
| M0-BE-11 | 09, 10 |
| M0-BE-12 | 11 |
| M0-BE-13 | 12 |
| M0-BE-14 | 03, 04 |
| M0-BE-15 | 13, 14 |
| M0-BE-16 | 14 |
| M0-BE-17 | 04, 28 |
| M0-BE-18 | 04 |
| M0-BE-19 | 01 |
| M0-BE-20 | 15, 16, 18 |
| M0-BE-21 | 15 |
| M0-BE-22 | 15, 18 |
| M0-BE-23 | 15 |
| M0-BE-24 | 04, 13 |
| M0-BE-25 | 20, 21, 22, 23, 31 |
| M0-BE-30 | 11 |
| M0-BE-31 | 15, 32 |
| M0-BE-32 | 30 |
| M0-BE-26 | 01 |
| M0-BE-27 | 26 |
| M0-BE-28 | 01 |
| M0-BE-29 | 03 |

### 4.3 Frontend — REYKI

- [ ] **M0-FE-01 Theme.** Tokens from `DESIGN.md` §10, 60-30-10 theme map, Plus Jakarta Sans. *Done when:* changing the map re-themes the app with no component edit.
- [ ] **M0-FE-02 Base components.** Buttons, fields, cards, badges, tabs, tables, modal, sheet, toast, skeleton, empty, error, offline bar. Motion foundation: `motion` dependency, `components/motion/tokens.ts`, `LazyMotion` + `MotionConfig reducedMotion="user"` provider, with press, modal, sheet and toast motion built on it (`DESIGN.md` §4.5). *Done when:* each has every state in `DESIGN.md` §6, works by keyboard, and moves only by opacity with reduced motion.
- [ ] **M0-FE-03 Translations.** English and Bahasa Indonesia, language switch, number and date formats. *Done when:* no screen has hard-coded text.
- [ ] **M0-FE-04 Auth screens.** Login, signup, check email, forgot, reset, invalid link. *Done when:* errors keep the user's input.
- [ ] **M0-FE-05 Create restaurant.** Name, live slug check, first location with tax and service defaults. *Done when:* it ends on the restaurant dashboard.
- [ ] **M0-FE-06 Admin shell.** Sidebar from permissions, location switcher, no-access and global error pages. *Done when:* each role sees only its navigation.
- [ ] **M0-FE-07 Staff screens.** Members, pending invites, invite form, role and location edit, deactivate, accept page. *Done when:* a bad invite link always shows the same generic page.
- [ ] **M0-FE-08 Role editor.** Permission checklist, system roles read-only, locked state by package. *Done when:* an owner can create and assign a role.
- [ ] **M0-FE-09 Public and platform shells.** Marketing layout, guarded super admin layout with its dark sidebar, storefront placeholder and suspended notice. The marketing layout mounts Lenis driven by GSAP's ticker with `ScrollTrigger` (`DESIGN.md` §4.5.3); `gsap`, `@gsap/react` and `lenis` load only there. *Done when:* each surface opens on its own route, and no other surface's bundle includes GSAP or Lenis.
- [ ] **M0-FE-10 Emails.** Confirmation, recovery and staff invitation in the Restomate theme. *Done when:* links use `token_hash` and render in Mailpit.

### 4.4 QA — DAVIN

- [ ] **M0-QA-01 Test base.** Test plan, bug and report templates, pgTAP and Playwright setup. *Done when:* both suites run in CI.
- [ ] **M0-QA-02 Isolation.** Select, insert, update and delete across two tenants on every table. *Done when:* every cross-tenant attempt fails.
- [ ] **M0-QA-03 Abuse.** Escalation, last owner, limits, reused, expired and wrong-email invites, slug rules, rate limit. *Done when:* each is refused.
- [ ] **M0-QA-04 End to end.** Signup, confirm, create restaurant, invite Cashier, accept, deactivate. *Done when:* the exit passes on desktop and tablet.
- [ ] **M0-QA-05 Sign-off.** *Done when:* `docs/qa/M0-signoff.md` gives evidence for each line below.

**Acceptance**
- [ ] **4.9.1** Invite staff by email; they set their own password.
- [ ] **4.9.2** Default roles: Owner, Manager, Cashier, Waiter, Kitchen. Owners can create custom roles from a permission checklist.
- [ ] **4.9.3** Staff can be limited to specific locations.
- [ ] **4.9.6** Deactivating a staff member signs them out everywhere.

### 4.5 Close — ALAN

- [ ] **M0-CL-01 Review and merge.** *Done when:* all M0 PRs are merged in order and `main` is green.
- [ ] **M0-CL-02 Staging.** Deploy, run Supabase advisors, request approval for the first platform admin. *Done when:* login works on staging.
- [ ] **M0-CL-03 Close.** *Done when:* boxes and §1 are updated and M1 is named active.

---

## 5. M1 — Signup and super admin

**Exit:** a new restaurant onboards end to end in under 5 minutes. A platform admin sees it, its plan and its usage.

### 5.1 Plan — ALAN

- [ ] **M1-LD-01 Commercials.** Get placeholder or final IDR prices, yearly discount and trial length from the project owner. *Done when:* recorded in §14.
- [ ] **M1-LD-02 Copy.** Get marketing copy and approved Terms and Privacy text in both languages. *Done when:* REYKI needs no invented text.
- [ ] **M1-LD-03 Board.** *Done when:* every M1 task is on the board with one owner.

### 5.2 Backend — ADIT and CARLO

- [ ] **M1-BE-01 Public data.** _(CARLO)_ Active public packages and the demo link target, cached by tag. *Done when:* a package edit refreshes pricing immediately.
- [ ] **M1-BE-02 Onboarding.** _(CARLO)_ Resumable steps, branding save, logo upload with type and size limits, plan choice, trial start. *Done when:* a failed step leaves no half-created restaurant.
- [ ] **M1-BE-03 Setup progress.** _(CARLO)_ Derived status for menu, tables, QR print, staff invite and test order. *Done when:* items whose feature doesn't exist yet report not done.
- [ ] **M1-BE-04 Tenants.** _(ADIT)_ Paginated search with plan, status, signup, locations and last activity. Detail with usage against limits, subscription history, owner contact, password-reset trigger and audit. *Done when:* only platform admins can read it.
- [ ] **M1-BE-05 Tenant status.** _(ADIT)_ `admin_set_org_status` with a reason. *Done when:* suspension blocks the admin, hides the storefront and is audited.
- [ ] **M1-BE-06 Package management.** _(ADIT)_ Create, edit, archive, limits, features, default. *Done when:* archiving doesn't affect existing tenants.
- [ ] **M1-BE-07 Platform settings.** _(ADIT)_ Signup on or off, maintenance banner, currencies, tax presets. *Done when:* changes are audited and take effect on the server.
- [ ] **M1-BE-08 Signup switch in Auth.** _(ADIT)_ Refuse signup in the Auth hook too. *Done when:* a direct call to Supabase `/signup` is refused while signup is off.
- [ ] **M1-BE-09 Funnel.** _(CARLO)_ `signup_completed`, `onboarding_completed`, `trial_started` and a dashboard. *Done when:* events carry no personal data.
- [ ] **M1-BE-10 Contracts.** _(ADIT)_ Packages, tenants, platform settings. *Done when:* published in `docs/contracts/`.
- [ ] **M1-BE-11 Contracts.** _(CARLO)_ Public data, onboarding. *Done when:* published in `docs/contracts/`.

### 5.3 Frontend — REYKI

- [ ] **M1-FE-01 Marketing.** Home, Features, Demo, with hreflang and metadata. *Done when:* both languages are indexable.
- [ ] **M1-FE-02 Pricing.** Cards and comparison from package data. *Done when:* no price is hard-coded.
- [ ] **M1-FE-03 Legal.** Terms and Privacy. *Done when:* the approved text shows in both languages.
- [ ] **M1-FE-04 Onboarding.** Account, web address, location, skippable branding, plan, with a step indicator. *Done when:* back and resume keep answers.
- [ ] **M1-FE-05 Setup checklist.** Dashboard list with progress. *Done when:* it follows real progress and hides when complete.
- [ ] **M1-FE-06 Tenants.** List, filters, detail, suspend and reactivate with a typed reason. *Done when:* usage and status are clear at a glance.
- [ ] **M1-FE-07 Packages.** List, editor, archive confirmation. *Done when:* limits and features are editable.
- [ ] **M1-FE-08 Settings and banner.** Settings form, maintenance banner, signup-closed page. *Done when:* each setting has a visible result.
- [ ] **M1-FE-09 Locked features.** Reusable upgrade state. *Done when:* a locked feature is never hidden or broken.

### 5.4 QA — DAVIN

- [ ] **M1-QA-01 Onboarding.** Timed run, interrupted steps, duplicate slug, double submit. *Done when:* under 5 minutes with no partial tenant.
- [ ] **M1-QA-02 Platform.** Admin-only access, package edits, suspension, signup switch, audit. *Done when:* tenant users are refused throughout.
- [ ] **M1-QA-03 Public pages.** Both languages, accessibility, pricing match, funnel payloads. *Done when:* WCAG 2.1 AA passes.
- [ ] **M1-QA-04 Sign-off.** *Done when:* `docs/qa/M1-signoff.md` covers each line below.

**Acceptance**
- [ ] **5.1.1** List and search restaurants with plan, status, signup date, locations, last activity.
- [ ] **5.1.2** Tenant detail: usage against plan limits, subscription history, owner contact.
- [ ] **5.1.3** Suspend / reactivate a tenant (suspended tenants see a notice; their customer site shows "temporarily unavailable").
- [ ] **5.1.4** Create and edit plans: name, monthly/yearly price, currency, trial days, limits, included features.
- [ ] **5.1.5** Archive a plan without affecting tenants already on it.
- [ ] **5.1.11** Every super admin action is recorded in an audit log.
- [ ] **5.2.1** Whole flow completes in under 5 minutes.
- [ ] **5.2.2** A failed step never leaves a half-created restaurant.
- [ ] **5.2.3** Pricing page always matches the active packages in the super admin.

### 5.5 Close — ALAN

- [ ] **M1-CL-01 Review and merge.** *Done when:* all M1 PRs are merged and staging is checked.
- [ ] **M1-CL-02 Close.** *Done when:* boxes and §1 are updated and M2 is named active.

---

## 6. M2 — Venue and menu

**Exit:** a restaurant sets up locations, a full menu and a floor plan, and prints QR codes for every table.

### 6.1 Plan — ALAN

- [ ] **M2-LD-01 Field research.** Watch a real service or interview staff about menu and table setup. *Done when:* pain points are written into the tasks.
- [ ] **M2-LD-02 Rules.** Confirm table limits, image limits, dietary tags and sample menu. *Done when:* recorded in §14.
- [ ] **M2-LD-03 Board.** *Done when:* every M2 task is on the board with one owner.

### 6.2 Backend — ADIT and CARLO

- [ ] **M2-BE-01 Locations.** _(ADIT)_ Add, edit, deactivate, with limits and permission. *Done when:* a small chain can manage every branch.
- [ ] **M2-BE-02 Areas.** _(ADIT)_ `areas` per location: name, order, active. *Done when:* create, rename, reorder and disable work.
- [ ] **M2-BE-03 Tables.** _(ADIT)_ `tables`: one area, capacity, position, status, `qr_token`, `max_tables` limit. *Done when:* a table can't point at another tenant's area.
- [ ] **M2-BE-04 QR tokens.** _(ADIT)_ Random token, rotate, printable payload. *Done when:* an old token stops working at once.
- [ ] **M2-BE-05 Stations.** _(ADIT)_ `kitchen_stations` per location and category routing. *Done when:* each category resolves to a station.
- [ ] **M2-BE-06 Menu schema.** _(CARLO)_ `menu_categories`, `menu_items`, `item_variants`, `modifier_groups`, `modifiers`, dietary tags, tax rate, published flag. *Done when:* minimum and maximum selections are enforced.
- [ ] **M2-BE-07 Overrides.** _(CARLO)_ `location_menu_overrides` for price, availability and sold out today. *Done when:* sold out resets on the location's local day.
- [ ] **M2-BE-08 Menu actions.** _(CARLO)_ Create, edit, archive, reorder, publish. *Done when:* each is permission-checked and refreshes its cache tag.
- [ ] **M2-BE-09 Images.** _(CARLO)_ Tenant-scoped storage, type and size checks, cleanup. *Done when:* one tenant can't write another's files.
- [ ] **M2-BE-10 Realtime.** _(CARLO)_ Menu changes per location. *Done when:* a subscriber sees a change within 2 seconds.
- [ ] **M2-BE-11 Sample data.** _(CARLO)_ Optional sample menu and tables in onboarding. *Done when:* it runs once and respects limits.
- [ ] **M2-BE-12 Contracts.** _(ADIT)_ Locations, venue, QR. *Done when:* published in `docs/contracts/`.
- [ ] **M2-BE-13 Contracts.** _(CARLO)_ Menu. *Done when:* published in `docs/contracts/`.

### 6.3 Frontend — REYKI

- [ ] **M2-FE-01 Locations.** List and editor with tax and timezone. *Done when:* the switcher updates after a change.
- [ ] **M2-FE-02 Areas.** List, rename, reorder, disable. *Done when:* it works by touch and keyboard.
- [ ] **M2-FE-03 Floor plan.** Drag and drop per area, capacity, undo, saving state. *Done when:* usable on a 10" tablet.
- [ ] **M2-FE-04 QR printing.** Download, A4 sheet, table tents, regenerate confirmation. *Done when:* printed codes scan.
- [ ] **M2-FE-05 Menu list.** Categories and items with search, reorder and publish. *Done when:* a long menu stays easy to use.
- [ ] **M2-FE-06 Item editor.** Variants, modifiers, tags, image, tax, price. *Done when:* a failed save keeps all input.
- [ ] **M2-FE-07 Overrides.** Per-location price and availability, sold-out toggle. *Done when:* inherited and overridden values look different.
- [ ] **M2-FE-08 Stations.** Station list and category assignment. *Done when:* unassigned categories are flagged.
- [ ] **M2-FE-09 Sample-data step.** Onboarding option and checklist links. *Done when:* a new owner can skip or accept it.

### 6.4 QA — DAVIN

- [ ] **M2-QA-01 Isolation and limits.** Every new table and the storage bucket. *Done when:* cross-tenant access and over-limit writes fail.
- [ ] **M2-QA-02 Venue.** Locations, areas, floor plan, QR rotation and scan. *Done when:* a tablet walkthrough passes.
- [ ] **M2-QA-03 Menu.** Modifiers, overrides, local-day reset, 2-second updates. *Done when:* every rule has a test.
- [ ] **M2-QA-04 Sign-off.** *Done when:* `docs/qa/M2-signoff.md` covers each line below.

**Acceptance**
- [ ] **4.1.US1** As an owner, I can create categories, items, variants (e.g. size) and modifier groups (e.g. extra cheese, spice level).
- [ ] **4.1.US2** As an owner, I can share one menu across locations and override price or availability per location.
- [ ] **4.1.1** Items have name, description, image, price, tax rate, variants, modifier groups (min/max selections), dietary tags, and a published flag.
- [ ] **4.1.2** Per-location overrides for price, availability and sold-out status.
- [ ] **4.1.4** Reordering categories and items by drag and drop.
- [ ] **4.7.US2** As a manager, I can download and print QR codes for every table.
- [ ] **4.7.1** Each table has its own QR code; codes can be regenerated if misused.
- [ ] **4.10.1** Visual floor plan per area with drag-and-drop table placement.
- [ ] **4.11.1** Create, rename, reorder and disable areas per location.
- [ ] **4.11.2** Tables belong to exactly one area.

### 6.5 Close — ALAN

- [ ] **M2-CL-01 Review and merge.** *Done when:* all M2 PRs are merged and staging is checked.
- [ ] **M2-CL-02 Close.** *Done when:* boxes and §1 are updated and M3 is named active.

---

## 7. M3 — Service core (MVP)

**Exit:** a full dine-in service runs on Restomate with cash at Demo Restaurant.

### 7.1 Plan — ALAN

- [ ] **M3-LD-01 Field research.** Watch a busy cashier, waiter and kitchen. *Done when:* pain points are written into the tasks.
- [ ] **M3-LD-02 Hardware and tipping.** Get decisions on launch printers, cash drawers and tipping. *Done when:* recorded in §14.
- [ ] **M3-LD-03 KDS thresholds.** `PROJECT.md` says configurable and `DESIGN.md` §6.4 says fixed 10 and 20 minutes. *Done when:* both docs agree. This plan follows `PROJECT.md`, with 10 and 20 as defaults.
- [ ] **M3-LD-04 Board.** *Done when:* every M3 task is on the board with one owner.

### 7.2 Backend — ADIT and CARLO

**Orders and kitchen**
- [ ] **M3-BE-01 Order schema.** _(ADIT)_ `orders` (channel, table, waiter, status), `order_items` and `order_item_modifiers` (snapshots, notes), `order_events` (who, when, reason). *Done when:* menu edits never change past orders.
- [ ] **M3-BE-02 State machine.** _(ADIT)_ placed → accepted → preparing → ready → served → completed, or cancelled. *Done when:* illegal transitions fail in tests and in the database.
- [ ] **M3-BE-03 Order actions.** _(ADIT)_ Open, add round, send, serve, complete, idempotent submit. *Done when:* only new items go to the kitchen and a retry makes no duplicate.
- [ ] **M3-BE-04 Voids.** _(ADIT)_ Item or order, with `orders.void` and a reason. *Done when:* the history records both.
- [ ] **M3-BE-05 Tickets.** _(ADIT)_ `kitchen_tickets` and `kitchen_ticket_items`, station routing, item and ticket status, bump. *Done when:* ticket and order status stay consistent.
- [ ] **M3-BE-06 KDS settings.** _(ADIT)_ Amber and red thresholds per location. *Done when:* defaults are 10 and 20 minutes.
- [ ] **M3-BE-07 Table service.** _(ADIT)_ Available, reserved, occupied, needs cleaning, waiter assignment, move, merge, seated time, running total. *Done when:* moves and merges are atomic.
- [ ] **M3-BE-08 Service realtime.** _(ADIT)_ Orders, tickets, tables and ready alerts per location. *Done when:* order to ticket is under 2 seconds at p95.

**Bills and money**
- [ ] **M3-BE-09 Bills.** _(CARLO)_ `bills` and `bill_items` with rate snapshots, service charge and tax. *Done when:* totals match `lib/money` exactly.
- [ ] **M3-BE-10 Discounts.** _(CARLO)_ `discounts`: percent or fixed, item or bill, `pos.discount`. *Done when:* a total can't go below zero.
- [ ] **M3-BE-11 Split.** _(CARLO)_ By item or equal shares. *Done when:* shares always add up to the bill, including rounding.
- [ ] **M3-BE-12 Payments.** _(CARLO)_ `payments` for cash with change, recorded EDC card and other, with mixed and partial payments and derived status. *Done when:* concurrent payments can't overpay a bill.
- [ ] **M3-BE-13 Payments list.** _(CARLO)_ Live query by status, method, date and staff. *Done when:* it respects location access.
- [ ] **M3-BE-14 Cash-up.** _(CARLO)_ `cash_sessions` with expected, counted and variance note per method. *Done when:* a closed session can't be edited.
- [ ] **M3-BE-15 Print data.** _(CARLO)_ Bill and KOT payloads, tax ID, logo and footer settings, duplicate marker. *Done when:* any past bill reprints from its snapshot.
- [ ] **M3-BE-16 Contracts.** _(ADIT)_ Orders, kitchen, tables. *Done when:* published in `docs/contracts/`.
- [ ] **M3-BE-17 Contracts.** _(CARLO)_ Bills, payments, printing. *Done when:* published in `docs/contracts/`.

### 7.3 Frontend — REYKI

- [ ] **M3-FE-01 POS layout.** Category rail, item grid, cart, live menu, dine-in and takeaway. *Done when:* a simple item is one tap and the response is under 200 ms.
- [ ] **M3-FE-02 Modifiers and notes.** Sheet with required groups. *Done when:* an item with modifiers takes the fewest possible taps.
- [ ] **M3-FE-03 Cart safety.** Local persistence, reconnecting bar, safe retry. *Done when:* refresh or lost Wi-Fi never loses a cart.
- [ ] **M3-FE-04 Order actions.** Send, add round, discount, void, keyboard shortcuts. *Done when:* actions follow permissions.
- [ ] **M3-FE-05 Live board.** Channel and status filters, refetch on reconnect. *Done when:* it recovers without a reload.
- [ ] **M3-FE-06 KDS.** Stations, timers, notes, item status, bump, threshold settings. *Done when:* readable at a distance.
- [ ] **M3-FE-07 Ready alerts.** Waiter notification by table. *Done when:* it appears without a refresh.
- [ ] **M3-FE-08 Table status.** Live colours with labels, seated time, total, assign, move, merge. *Done when:* the cleaning cycle works by touch.
- [ ] **M3-FE-09 Bill and payment.** Split, partial, cash and change, EDC, other, balance due. *Done when:* the amount due is the biggest number on screen.
- [ ] **M3-FE-10 Payments and cash-up.** List, filters, count, variance note. *Done when:* a shift closes without a spreadsheet.
- [ ] **M3-FE-11 Printing.** 80 mm, 58 mm and A4 bills and KOTs, bill settings. *Done when:* prints are black on white and reprints say "Duplicate".

### 7.4 QA — DAVIN

- [ ] **M3-QA-01 Money.** Tax, discounts, split rounding, concurrent payments, cash-up. *Done when:* all calculations match worked examples.
- [ ] **M3-QA-02 Security.** Isolation, location access, every role against every action. *Done when:* all forbidden actions fail.
- [ ] **M3-QA-03 Resilience.** Disconnect, reload, double tap, realtime recovery, latency. *Done when:* no lost cart or duplicate order.
- [ ] **M3-QA-04 Dine-in flow.** Seat → order → KOT → ready → serve → bill → split cash → print → clean. *Done when:* it passes in Playwright and on real device sizes.
- [ ] **M3-QA-05 Sign-off.** *Done when:* `docs/qa/M3-signoff.md` covers each line below.

**Acceptance**
- [ ] **4.1.5** Editing an item never changes the price or name on past orders.
- [ ] **4.2.US1** As a waiter, I can open an order for a table, add items with modifiers and notes, and send it to the kitchen.
- [ ] **4.2.US2** As a manager, I can see all open orders for my location on a live board, filtered by channel (dine-in, takeaway, QR, online) and status.
- [ ] **4.2.US3** As a manager, I can void an item or order with a reason.
- [ ] **4.2.1** Order statuses follow: placed → accepted → preparing → ready → served → completed (or cancelled).
- [ ] **4.2.2** Items can be added to an already-sent order; only the new items go to the kitchen.
- [ ] **4.2.3** Voids require the `orders.void` permission and a reason, and are recorded in the order history.
- [ ] **4.2.4** Live board updates in real time and recovers after a lost connection.
- [ ] **4.2.5** Every status change records who did it and when.
- [ ] **4.4.US1** As a cashier, I can take a takeaway or dine-in order quickly with a touch-friendly grid of categories and items.
- [ ] **4.4.US2** As a cashier, I can apply a discount (if permitted), print the bill, and take payment.
- [ ] **4.4.US3** As a cashier, I can split a bill by item or by equal shares.
- [ ] **4.4.1** Works well on a 10" tablet and a desktop touch screen.
- [ ] **4.4.2** Adding an item to the cart takes at most two taps (one if it has no required modifiers).
- [ ] **4.4.3** Discounts (percentage or fixed, per item or per bill) require `pos.discount`.
- [ ] **4.4.4** Shows a clear offline/reconnecting state; never silently loses a cart.
- [ ] **4.4.5** Keyboard shortcuts for frequent actions on desktop.
- [ ] **4.5.US1** As kitchen staff, I see new tickets appear instantly on the kitchen display, grouped by station (e.g. grill, bar).
- [ ] **4.5.US2** As kitchen staff, I can mark an item or a whole ticket as in progress or ready.
- [ ] **4.5.US3** As a waiter, I'm notified when a table's items are ready.
- [ ] **4.5.1** Ticket shows table/order number, items, modifiers, notes, and time since placed.
- [ ] **4.5.2** Tickets turn amber and then red when they pass configurable time thresholds.
- [ ] **4.5.3** Items route to stations based on category settings.
- [ ] **4.5.4** KOTs can also be printed on a kitchen printer.
- [ ] **4.5.5** Order → ticket visible in under 2 seconds (p95).
- [ ] **4.10.2** Table states: available, reserved, occupied, needs cleaning — color coded and live.
- [ ] **4.10.3** Assign a waiter to a table; move an order to another table; merge tables.
- [ ] **4.10.4** Each table shows time seated and current bill total.
- [ ] **4.12.1** Prints on 80 mm and 58 mm thermal printers and on A4.
- [ ] **4.12.2** Bill shows logo, restaurant details, tax ID, items, modifiers, taxes, discounts, service charge, total, payments and balance due.
- [ ] **4.12.3** Footer text and logo configurable in Settings.
- [ ] **4.12.4** Reprint any past bill; reprints are marked "Duplicate".
- [ ] **4.13.2** Multiple payments per bill with mixed methods (cash, card, online, other).
- [ ] **4.13.3** Live payments list filterable by status, method, date and staff.
- [ ] **4.13.4** End-of-day cash-up: expected vs counted cash per method, with a variance note.

### 7.5 Close — ALAN

- [ ] **M3-CL-01 Review and merge.** *Done when:* all M3 PRs are merged and staging is checked.
- [ ] **M3-CL-02 MVP check.** *Done when:* a full cash service is demonstrated to the project owner.
- [ ] **M3-CL-03 Close.** *Done when:* boxes and §1 are updated and M4 is named active.

---

## 8. M4 — Customer site

**Exit:** guests order from a table and online for pickup at Demo Restaurant, paying at the counter.

### 8.1 Plan — ALAN

- [ ] **M4-LD-01 Domains.** Get the root, app and wildcard domains approved and available. *Done when:* the host map is in §14.
- [ ] **M4-LD-02 Guest rules.** Confirm opening hours, pickup timing, QR approval default and three layouts. *Done when:* recorded in §14.
- [ ] **M4-LD-03 Board.** *Done when:* every M4 task is on the board with one owner.

### 8.2 Backend — ADIT and CARLO

- [ ] **M4-BE-01 Host separation.** _(CARLO)_ `{slug}` storefront, `app.` admin, root marketing, redirects. `proxy.ts` rewrites tenant hosts to the storefront route `/s/<slug>/...` (built in M0-FE-09), and `/s/*` returns 404 on every other host. *Done when:* each surface answers only on its host.
- [ ] **M4-BE-02 Storefront data.** _(CARLO)_ Menu, branding, locations, contact, demo logo seed. *Done when:* only published data of active orgs is public.
- [ ] **M4-BE-03 Opening hours.** _(ADIT)_ Hours and exceptions per location timezone. *Done when:* closed locations refuse orders.
- [ ] **M4-BE-04 Guest sessions.** _(ADIT)_ Table-linked session and private order-status token. *Done when:* one guest can't read another's order.
- [ ] **M4-BE-05 Order intake.** _(ADIT)_ QR and pickup, price recompute, availability, hours, Arcjet, idempotency. *Done when:* tampered or repeated requests are refused.
- [ ] **M4-BE-06 QR approval.** _(ADIT)_ Automatic or staff-approved per location. *Done when:* unapproved orders never reach the KDS.
- [ ] **M4-BE-07 Table requests.** _(CARLO)_ Call waiter and request bill, rate limited. *Done when:* staff see them live.
- [ ] **M4-BE-08 Pickup.** _(ADIT)_ Pay at counter, ready notification by live status and email. *Done when:* the order can be completed from the board.
- [ ] **M4-BE-09 Guest realtime.** _(ADIT)_ Order status and menu changes. *Done when:* updates arrive within 2 seconds without exposing other data.
- [ ] **M4-BE-10 Contracts.** _(ADIT)_ Guest orders, hours. *Done when:* published in `docs/contracts/`.
- [ ] **M4-BE-11 Contracts.** _(CARLO)_ Storefront, table requests. *Done when:* published in `docs/contracts/`.

### 8.3 Frontend — REYKI

- [ ] **M4-FE-01 Branded shell.** `brand-*` variables, contrast-safe text, three layout presets, fallback theme. *Done when:* no Restomate colour overrides a tenant's brand.
- [ ] **M4-FE-02 Menu and item.** Categories, photos, tags, modifiers, sold out. *Done when:* fast on a mid-range phone.
- [ ] **M4-FE-03 Cart and checkout.** Persistent cart, guest details, pickup or table. *Done when:* server price changes are explained.
- [ ] **M4-FE-04 QR entry.** `/t/{qr_token}`, table label, invalid-code page. *Done when:* scan to order needs no account.
- [ ] **M4-FE-05 Order status.** Live steps, call waiter, request bill. *Done when:* it survives a reload.
- [ ] **M4-FE-06 Locations and about.** Picker, hours, contact, closed state. *Done when:* a guest can't order from a closed branch.
- [ ] **M4-FE-07 Staff side.** QR approval, guest requests, hours and QR settings. *Done when:* usable on the live board.
- [ ] **M4-FE-08 Ready email.** Restaurant-branded pickup email. *Done when:* it renders in Mailpit.

### 8.4 QA — DAVIN

- [ ] **M4-QA-01 Guest security.** Tampered price, guessed token, old QR, abuse, host separation. *Done when:* all are refused.
- [ ] **M4-QA-02 QR and pickup flows.** Both flows from `PROJECT.md` §7, with and without approval. *Done when:* both pass end to end.
- [ ] **M4-QA-03 Quality.** WCAG 2.1 AA, supported browsers, Lighthouse mobile. *Done when:* performance is 90 or higher.
- [ ] **M4-QA-04 Sign-off.** *Done when:* `docs/qa/M4-signoff.md` covers each line below.

**Acceptance**
- [ ] **4.1.US3** As a manager, I can mark an item as sold out for today, and it disappears from the POS and the customer site immediately.
- [ ] **4.1.3** Changes appear on POS and customer site within 2 seconds without a page reload.
- [ ] **4.7.US1** As a guest, I scan the QR on my table, see the menu, add items, and place an order linked to my table.
- [ ] **4.7.US3** As a manager, I can choose whether QR orders go to the kitchen automatically or need staff approval first.
- [ ] **4.7.2** QR orders appear on the live order board and (based on settings) on the KDS.
- [ ] **4.7.3** Guests can see their order status and call a waiter / request the bill.
- [ ] **4.7.5** Works on any phone browser without installing an app.
- [ ] **4.15.1** Available at `{slug}.restomate.app` from the moment the restaurant signs up.
- [ ] **4.15.4** Location picker for multi-location restaurants; respects opening hours.
- [ ] **4.15.5** Mobile Lighthouse performance score ≥ 90.

### 8.5 Close — ALAN

- [ ] **M4-CL-01 Review and merge.** *Done when:* all M4 PRs are merged and staging is checked.
- [ ] **M4-CL-02 Close.** *Done when:* boxes and §1 are updated and M5 is named active.

---

## 9. M5 — Payments (DOKU)

**Exit:** online payments reconcile in DOKU sandbox, then in one low-value production transaction approved by the project owner.

### 9.1 Plan — ALAN

- [ ] **M5-LD-01 Merchant onboarding.** Get a decision: assisted or bring your own account. *Done when:* recorded in §14.
- [ ] **M5-LD-02 Access.** Arrange sandbox and production merchant access and test method list. *Done when:* credentials are only in secret storage.
- [ ] **M5-LD-03 Board.** *Done when:* every M5 task is on the board with one owner.

### 9.2 Backend — ADIT and CARLO

- [ ] **M5-BE-01 Gateway accounts.** _(CARLO)_ `payment_gateway_accounts`: encrypted credentials per org, sandbox or live, connection test. *Done when:* a secret is never returned to the browser.
- [ ] **M5-BE-02 Provider interface.** _(CARLO)_ `createCheckout`, `getStatus`, `verifyNotification`, `parseNotification`. *Done when:* a new gateway needs no change outside the payments module.
- [ ] **M5-BE-03 Signature.** _(CARLO)_ DOKU Non-SNAP signing and verification. *Done when:* DOKU's documented vectors pass.
- [ ] **M5-BE-04 Checkout.** _(CARLO)_ Invoice number (`RM-…`) stored before redirect, full or partial amount. *Done when:* a double submit creates one payment.
- [ ] **M5-BE-05 Webhook.** _(CARLO)_ Raw body, signature, secret by Client-Id, dedup in `payment_notifications`, amount and currency check, one transaction, fast 200. *Done when:* two deliveries apply once.
- [ ] **M5-BE-06 Reconciliation.** _(CARLO)_ Check Status for pending payments older than 15 minutes. *Done when:* a lost notification still resolves.
- [ ] **M5-BE-07 Expiry.** _(CARLO)_ 60-minute default and retry. *Done when:* an expired link can be replaced safely.
- [ ] **M5-BE-08 Refunds.** _(CARLO)_ `refunds`: full and partial, `payments.refund`, manual path where there is no API. *Done when:* refunds can't exceed what was paid.
- [ ] **M5-BE-09 Paid-order rules.** _(ADIT)_ Online orders enter the kitchen after payment when required, tables close when paid. *Done when:* a redirect alone changes nothing.
- [ ] **M5-BE-10 Contracts.** _(CARLO)_ Gateway, checkout, refunds. *Done when:* published in `docs/contracts/`.
- [ ] **M5-BE-11 Contracts.** _(ADIT)_ Paid-order rules. *Done when:* published in `docs/contracts/`.

### 9.3 Frontend — REYKI

- [ ] **M5-FE-01 DOKU settings.** Connect, test, switch to live, masked secret. *Done when:* the current mode is unmistakable.
- [ ] **M5-FE-02 Guest checkout.** Online and pay at table, package-gated. *Done when:* cash still works without a gateway.
- [ ] **M5-FE-03 Return states.** Confirming, paid, failed, expired, retry. *Done when:* paid shows only from server state.
- [ ] **M5-FE-04 POS.** Show QRIS, send payment link, live confirmation. *Done when:* a cashier needn't refresh.
- [ ] **M5-FE-05 Refunds.** Full or partial with confirmation and history. *Done when:* refunded status is visible on the bill and list.

### 9.4 QA — DAVIN

- [ ] **M5-QA-01 Webhook.** Bad signature, duplicate, wrong amount or currency, late and FAILED events. *Done when:* none can wrongly mark paid.
- [ ] **M5-QA-02 Sandbox methods.** QRIS, virtual account, e-wallet, card, paylater where enabled. *Done when:* each reconciles.
- [ ] **M5-QA-03 Money.** Mixed online and cash, partial, expiry, refund, cash-up. *Done when:* every total balances.
- [ ] **M5-QA-04 Sign-off.** *Done when:* `docs/qa/M5-signoff.md` covers each line below, using sandbox only.

**Acceptance**
- [ ] **4.7.4** Optional pay-at-table online payment.
- [ ] **4.8.US1** As an owner, I connect my restaurant's own DOKU merchant account in Settings, test it in sandbox, then switch it to live.
- [ ] **4.8.US2** As a guest, I pay for my QR or online order on DOKU's checkout page with the method I prefer, and my order updates to "paid" automatically.
- [ ] **4.8.US3** As a cashier, I can show a DOKU QRIS code or send a payment link for a table's bill instead of taking cash.
- [ ] **4.8.1** Each restaurant connects its own DOKU account (Client ID + Secret Key) from Settings; the money goes straight to the restaurant, not through Restomate.
- [ ] **4.8.2** DOKU supported at launch; adding another gateway later needs no changes outside the payments module.
- [ ] **4.8.3** Online payments on the customer site and pay-at-table.
- [ ] **4.8.4** A payment becomes "paid" only after a verified DOKU notification (or a status check), never just because the guest was redirected back.
- [ ] **4.8.5** Unpaid DOKU payment links expire (default 60 minutes) and the order shows "payment expired" with a retry button.
- [ ] **4.8.6** Refunds (full and partial) from the admin, requiring `payments.refund`.
- [ ] **4.8.7** Gateway events are processed exactly once, even if delivered twice.
- [ ] **4.13.1** Bill payment status: unpaid, partially paid, paid, refunded.

### 9.5 Close — ALAN

- [ ] **M5-CL-01 Review and merge.** *Done when:* all M5 PRs are merged and sandbox reconciles on staging.
- [ ] **M5-CL-02 Production check.** Ask the project owner to approve and make one low-value transaction. *Done when:* it reconciles.
- [ ] **M5-CL-03 Close.** *Done when:* boxes and §1 are updated and M6 is named active.

---

## 10. M6 — Launch

**Exit:** public launch with paid plans, approved by the project owner.

### 10.1 Plan — ALAN

- [ ] **M6-LD-01 Business decisions.** Get final prices, notification channels, e-Faktur need and grace period. *Done when:* recorded in §14.
- [ ] **M6-LD-02 Launch checklist.** Support, incident contact, rollback, backups, status page, legal. *Done when:* the project owner agrees to it.
- [ ] **M6-LD-03 Board.** *Done when:* every M6 task is on the board with one owner.

### 10.2 Backend — ADIT and CARLO

**Reservations and customers**
- [ ] **M6-BE-01 Reservation schema.** _(ADIT)_ Rules, slots, blackout dates, statuses, exclusion constraint. *Done when:* overlapping bookings are impossible.
- [ ] **M6-BE-02 Booking.** _(ADIT)_ Availability, create, cancel link, confirmation email. *Done when:* only suitable free tables are offered.
- [ ] **M6-BE-03 Seating.** _(ADIT)_ Confirm, seat, open order, no-show count. *Done when:* seating updates the table atomically.
- [ ] **M6-BE-04 Customers.** _(CARLO)_ Profiles from bookings and online orders, history, spend, preferences, allergies, notes. *Done when:* duplicates are merged per tenant.
- [ ] **M6-BE-05 Feedback and deletion.** _(CARLO)_ Post-visit rating, low-rating alert, deletion request. *Done when:* deletion removes personal data and keeps financial totals.

**Reports and staff**
- [ ] **M6-BE-06 Reports.** _(ADIT)_ Security-invoker functions for sales, staff, tables, reservations, customers and payments, with compare and area filters. *Done when:* totals equal the source records.
- [ ] **M6-BE-07 CSV export.** _(ADIT)_ Permission and package gated. *Done when:* exports are safe from spreadsheet formula injection.
- [ ] **M6-BE-08 Schedules.** _(ADIT)_ Weekly shifts per location. *Done when:* staff read only their own unless they manage staff.
- [ ] **M6-BE-09 POS PIN.** _(ADIT)_ Hashed PIN, lockout, registered shared device. *Done when:* a PIN alone can't sign in elsewhere.

**Brand, billing and operations**
- [ ] **M6-BE-10 Theme.** _(CARLO)_ Draft and publish for logo, cover, colours, fonts, style and preset, also used by bills and emails. *Done when:* drafts are never public.
- [ ] **M6-BE-11 Subscription invoices.** _(CARLO)_ `platform_invoices` (`RMSUB-…`), Restomate DOKU checkout, emailed link. *Done when:* each period is billed once.
- [ ] **M6-BE-12 Billing lifecycle.** _(CARLO)_ Trial end, reminders, failure, grace, past due, read-only, recovery. *Done when:* each transition is tested and audited.
- [ ] **M6-BE-13 Billing admin.** _(CARLO)_ Invoices, renewals, failures, plan change, trial extension, manual credit. *Done when:* every action is audited.
- [ ] **M6-BE-14 Plan enforcement.** _(CARLO)_ All features and limits in `PROJECT.md` §6, including Basic tiers. *Done when:* no gate exists only in the UI.
- [ ] **M6-BE-15 Remaining platform settings.** _(ADIT)_ Enabled gateways and editable email templates. *Done when:* changes are audited and take effect.
- [ ] **M6-BE-16 Production readiness.** _(ADIT)_ SPF, DKIM, DMARC, SMTP, Arcjet live, monitoring, point-in-time recovery, status page. *Done when:* prepared, and production changes wait for approval.
- [ ] **M6-BE-17 Contracts.** _(ADIT)_ Reservations, reports, schedules, settings. *Done when:* published in `docs/contracts/`.
- [ ] **M6-BE-18 Contracts.** _(CARLO)_ Customers, theme, billing. *Done when:* published in `docs/contracts/`.

### 10.3 Frontend — REYKI

- [ ] **M6-FE-01 Guest booking.** Date, time, party size, confirmation, cancel, About and menu links. *Done when:* unavailable slots can't be picked.
- [ ] **M6-FE-02 Reservations admin.** Rules, timeline by area, seat, no-show. *Done when:* works on a tablet during service.
- [ ] **M6-FE-03 Customers.** List, profile, notes, feedback, deletion. *Done when:* allergies are easy to spot.
- [ ] **M6-FE-04 Reports.** Filters, comparison, accessible charts and tables, export. *Done when:* every chart has readable values.
- [ ] **M6-FE-05 Schedules and PIN.** Week editor, my shifts, shared-device PIN screen. *Done when:* usable by touch.
- [ ] **M6-FE-06 Theme editor.** Uploads, colours, fonts, style, presets, preview, contrast warning. *Done when:* the preview matches the published site.
- [ ] **M6-FE-07 Restaurant billing.** Plan, invoices, pay, past-due and read-only notices. *Done when:* the next action is always clear.
- [ ] **M6-FE-08 Platform billing.** Subscriptions, invoices, renewals, adjustments, settings. *Done when:* risky actions ask for a reason.
- [ ] **M6-FE-09 Emails.** Booking, feedback, receipt, invoice and reminder templates. *Done when:* guest emails use the restaurant's brand.
- [ ] **M6-FE-10 Language audit.** *Done when:* every surface is complete in both languages with no clipped text.

### 10.4 QA — DAVIN

- [ ] **M6-QA-01 Reservations and privacy.** Race conditions, cancel links, deletion, isolation. *Done when:* no double booking or leak.
- [ ] **M6-QA-02 Reports.** Fixtures with known totals across timezones. *Done when:* every total matches.
- [ ] **M6-QA-03 Billing.** Simulated clock through trial, failure, grace, read-only and recovery. *Done when:* each plan gets exactly its features.
- [ ] **M6-QA-04 Regression.** All five flows in `PROJECT.md` §7, supported devices, accessibility, load, restore drill. *Done when:* no open S1 or S2.
- [ ] **M6-QA-05 Sign-off.** *Done when:* `docs/qa/M6-signoff.md` covers each line below.

**Acceptance**
- [ ] **4.3.US1** As a guest, I can book a table on the customer site by choosing date, time and party size.
- [ ] **4.3.US2** As a manager, I can see reservations on a timeline per area, confirm, seat, or mark no-show.
- [ ] **4.3.US3** As an owner, I can set booking rules: time slots, slot length, max party size, lead time, blackout dates.
- [ ] **4.3.1** Only slots with a suitable free table are offered to guests.
- [ ] **4.3.2** Guests receive a branded confirmation email (sent through Resend) with a cancel link; SMS/WhatsApp later.
- [ ] **4.3.3** Seating a reservation marks the table occupied and can open an order directly.
- [ ] **4.3.4** No-shows are tracked per customer.
- [ ] **4.3.5** Double-booking the same table for overlapping times is impossible.
- [ ] **4.6.1** Sales by day, hour, item, category, location, channel and payment method.
- [ ] **4.6.2** Staff performance: orders taken, sales, voids, discounts given.
- [ ] **4.6.3** Table turnover and average dining time; reservation no-show rate.
- [ ] **4.6.4** Customer trends: new vs returning, top customers, average order value.
- [ ] **4.6.5** Outstanding and partial payments.
- [ ] **4.6.6** Date range picker, location filter, comparison with the previous period.
- [ ] **4.6.7** Export to CSV. Reports require `reports.view`.
- [ ] **4.9.4** Optional quick PIN login on shared POS devices.
- [ ] **4.9.5** Weekly shift schedule per location; staff see their own shifts.
- [ ] **4.11.3** Reservations and reports can be filtered by area.
- [ ] **4.14.1** Customer profile: name, phone, email, visit history, total spend, preferences, allergies, notes.
- [ ] **4.14.2** Customers are created automatically from reservations and online orders.
- [ ] **4.14.3** Post-visit feedback with rating and comment; low ratings are flagged to the manager.
- [ ] **4.14.5** Customers can ask for their data to be deleted.
- [ ] **4.15.3** Pages: menu, item detail, cart, checkout, order status, reservations, about/contact.
- [ ] **4.16.1** Upload logo and cover image; choose primary/accent colors, font pair, and light/dark style.
- [ ] **4.16.2** Choose from at least 3 layout presets for the customer site.
- [ ] **4.16.3** Live preview before publishing.
- [ ] **4.16.4** Branding also applies to printed bills and confirmation emails.
- [ ] **4.16.5** Color choices that fail contrast checks show a warning.
- [ ] **5.1.6** Restaurants pay their Restomate subscription through Restomate's own DOKU account; invoices are emailed (Resend) with a DOKU payment link.
- [ ] **5.1.7** Reminder emails before the due date and on failure; tenant moves to "past due" after a grace period (default 7 days), then read-only.
- [ ] **5.1.8** View subscriptions, invoices, failed payments and upcoming renewals.
- [ ] **5.1.9** Change a tenant's plan, extend a trial, or add a manual credit.
- [ ] **5.1.10** Default currencies, tax presets, enabled payment gateways, email templates, maintenance banner, enable/disable public signup.

**Non-functional acceptance (`PROJECT.md` §8)**
- [ ] **Performance:** POS actions respond in < 200 ms; kitchen tickets appear in < 2 s (p95); customer site mobile Lighthouse ≥ 90
- [ ] **Availability:** 99.9% monthly target for POS, KDS and customer site
- [ ] **Connectivity:** POS and KDS handle unstable Wi-Fi: clear offline state, automatic reconnect, no lost carts. Full offline mode is P2.
- [ ] **Security:** Strict tenant data isolation; bot protection and rate limits on public pages; signed payment webhooks; audit log of sensitive actions
- [ ] **Privacy:** No card data stored by Restomate; customer data deletable on request; no guest personal data in analytics
- [ ] **Devices:** Latest Chrome, Safari, Edge; iPad and Android tablets for POS/KDS; any modern phone for the customer site
- [ ] **Accessibility:** WCAG 2.1 AA on the customer site and signup frontend; large touch targets on POS/KDS
- [ ] **Localization:** Currency, tax and timezone per location; launch defaults IDR and Asia/Jakarta; English and Bahasa Indonesia at launch
- [ ] **Email delivery:** All email via Resend from a verified sending subdomain; auth emails delivered within 1 minute; failed sends logged and retryable

### 10.5 Close — ALAN

- [ ] **M6-CL-01 Review and merge.** *Done when:* all M6 PRs are merged and staging is checked.
- [ ] **M6-CL-02 Launch approval.** *Done when:* the project owner approves the checklist and the release.
- [ ] **M6-CL-03 Close.** *Done when:* launch is verified, boxes and §1 are updated.

---

## 11. M7 — After launch (backlog)

ALAN picks one item. It gets its own detailed tasks and passes all five steps before the next is picked.

### 11.1 Backlog

- [ ] **M7-01 Custom domains.** Verification, certificates, host mapping, plan gate.
- [ ] **M7-02 Loyalty.** Points per amount spent, redeem as a discount, adjustments, plan gate.
- [ ] **M7-03 SMS and WhatsApp notifications.** Consent, templates, retries.
- [ ] **M7-04 Offline POS.** Local queue, conflict handling, safe sync.
- [ ] **M7-05 Direct ESC/POS printing.** Local bridge, device setup.
- [ ] **M7-06 Inventory and recipe costing.** Needs a product spec first (`PROJECT.md` §10).
- [ ] **M7-07 Delivery app integrations.** Needs a product spec first.
- [ ] **M7-08 Accounting sync.** Needs a product spec first.

### 11.2 Steps for the picked item

1. **Plan — ALAN:** spec, acceptance criteria, tasks, decisions.
2. **Backend — ADIT or CARLO (one per item):** data, RLS, logic, integration, contract.
3. **Frontend — REYKI:** screens, states, both languages.
4. **QA — DAVIN:** isolation, acceptance, regression, sign-off.
5. **Close — ALAN:** review, merge, approved release.

**Acceptance for backlog items already in PROJECT.md**
- [ ] **4.14.4** Simple loyalty: points per amount spent, redeemable as a discount (P2).
- [ ] **4.15.2** Custom domain support (P1, on plans that include it).

---

## 12. Environments and delivery

| Environment | App | Database | Payments | Email |
|---|---|---|---|---|
| Local | `pnpm dev` | `supabase start` (Docker) | DOKU sandbox | Mailpit / `EMAIL_DELIVERY=log` |
| Preview | Vercel preview per PR | Supabase branch | DOKU sandbox | Resend (test domain) |
| Staging | See `STAGING.md` | Supabase staging project | DOKU sandbox | Resend |
| Production | `restomate.app`, `app.restomate.app`, `*.restomate.app` | Supabase production project | DOKU production | Resend (`mail.restomate.app`) |

CI on every PR: install → lint → typecheck → unit tests → build → database reset and pgTAP → Playwright (once M0-QA-01 exists).

Draft PRs never deploy to staging. DAVIN tests them locally or on preview, and staging updates when ALAN merges.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak | RLS and isolation tests on every table, review checklist |
| Cache Components learning curve | Follow §2, keep session reads in the access layer, track opt-outs in §14 |
| Missed or duplicate DOKU notifications | Idempotent dedup and the reconciliation job |
| Restaurants without a DOKU account | Cash and EDC work without a gateway |
| Unstable restaurant Wi-Fi | Reconnect and refetch, persisted carts, offline mode in M7 |
| Email deliverability | Dedicated sending subdomain, SPF, DKIM, DMARC |
| Regional tax differences | Rates per location, never hard-coded |
| Sequential steps create long PR stacks | Small PRs, strict stack order, rebase after each merge |
| Earlier staging data clashes with new migrations | Decide in M0-LD-01 before the first database deploy |
| A PR merges before QA | Every PR starts as a draft and auto-merge stays off |

---

## 14. Decisions log

### Decided

| Date | Decision | Source |
|---|---|---|
| 2026-11-22 | Restart from zero, with all progress cleared | Project owner |
| 2026-11-22 | ALAN Lead, ADIT backend, REYKI frontend, DAVIN QA | Project owner |
| 2026-11-22 | Work is focused per phase, with no overlapping phases | Project owner |
| Carried over | DOKU for guest payments and SaaS billing, Resend for email | `PROJECT.md` §11 |
| Carried over | Indonesia and IDR at launch, tax configurable per location | `PROJECT.md` §11 |
| 2026-11-22 | M0-LD-01: earlier code is reset (the repo holds none). Vercel project `restomate-staging` is kept. The staging Supabase project is kept and its schema is built only by forward-only migrations after merge. Nothing is deleted. `STAGING.md` names ref `hnpcfaecrdilwongitbg`, but the connected Supabase account lists only `Restomate-Dev` (`byexuyfafpnrcfedubtb`): ADIT confirms the target ref before the first staging deploy (M0-BE-24) | ALAN, under the owner's "restart from zero" |
| 2026-11-22 | Staging Supabase is `Restomate-Dev`, ref `byexuyfafpnrcfedubtb`, ap-southeast-1; `STAGING.md` updated. Owner will provide the `SUPABASE_STAGING_DB_URL` secret and service keys (M0-LD-03) | Project owner |
| 2026-11-22 | M0-LD-04: board `MF` holds `MF-T01` to `MF-T40` in PLAN order. Tasks are assigned at each step handoff, never earlier | ALAN |
| 2026-11-22 | M0-BE-01 (PR #3) and M0-BE-02 (PR #4) merged. Notes carried forward: BE-15/22 (4.9.6) must not rely on `'use cache: private'` for "signed out everywhere", because it can stay in the browser's router cache for 5 minutes and every action re-checks; `updateTag` works only in Server Actions, so route handlers such as the DOKU webhook use `revalidateTag`; BE-24's deploy gate must not wait for a CI run on a docs-only tip of main (CI skips `docs/**` and `*.md`); QA-01 Playwright files under `apps/web` cannot be `*.spec.ts`, or Vitest collects them; CI is run locally with `pnpm run ci` (plain `pnpm ci` is a pnpm built-in that checks nothing). Follow-ups: lint should use `--max-warnings 0`; branch protection on main is an owner decision before launch | ALAN, from ADIT and DAVIN reports |
| 2026-11-22 | CARLO joins as a second backend developer. Each backend task and file has one owner (§1.1) | Project owner |
| 2026-11-22 | Staging is Vercel project `restomate` (`restomate-nine.vercel.app`). This replaces `restomate-staging` from M0-LD-01, which is no longer used and is not deleted. Its Vercel "Production" target is staging, not the product's production | Project owner chose the project as the answer to "pick the staging project". ALAN's reading: staging, not production |
| 2026-11-22 | Staging setup still open when the project was chosen: four Vercel variables (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`), the Supabase Auth Site and Redirect URLs (Site URL was `localhost:3000`), and the `SUPABASE_STAGING_DB_URL` GitHub secret. M0-BE-04 merges only after a green Vercel build, M0-BE-24 needs the secret, M0-CL-02 needs the Auth URLs. A new encryption key is safe: the staging database had no tables | ALAN, from read-only checks |
| 2026-11-22 | Correction to the row above: at 17:24 UTC the owner added `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN` and `APP_ENCRYPTION_KEY` for Production. Still open at 17:57 UTC: those three for Preview, `SUPABASE_SERVICE_ROLE_KEY` for both, the Auth URLs and the GitHub secret | ALAN, from the Vercel activity log and read-only checks |
| 2026-11-22 | M0-BE-03 pins the Supabase CLI to exactly 3.2.0 (PR #9, merges after its gate and QA), because 2.122.1 has a `db reset` race (supabase/cli 7380). M0-BE-24 must use v3's explicit `--remote` target, and `--yes` only on the apply step | ALAN |
| 2026-11-22 | M0-BE-04 boot check: failing closed with 500 is accepted in place of exiting the process, because Next keeps the process up | ALAN, from CARLO's evidence |
| 2026-11-22 | Staging setup from the rows above is complete as of 18:13 UTC: the four Vercel variables are set for Production and Preview, the Auth Site and Redirect URLs work, and the `SUPABASE_STAGING_DB_URL` secret exists. Values are not verified: formats are tested by the first build with M0-BE-26 and M0-BE-04, the secret by M0-BE-24's dry run, the Supabase ref behind `NEXT_PUBLIC_SUPABASE_URL` in M0-CL-02 | ALAN, from the Vercel log, build logs and read-only checks |
| 2026-11-22 | ADIT and CARLO may hold a second task while the first is blocked, parked, or waiting for QA or merge (§1.2). This is the exception to assigning only to agents HQ shows as free | Project owner, marked the yes/no request done at 18:25 UTC. ALAN read that as yes |
| 2026-11-22 | M0-BE-19 default, as the spec has no rounding rule: half up to the smallest unit, separately for service charge and for tax. Tax applies to the subtotal, plus the service charge when the location's flag is on. Reconfirm in M3 Plan | ALAN, default. The project owner can change it |
| 2026-11-22 | M0-BE-19 details: tax on service uses the rounded service charge the bill shows; `formatMoney` writes a plain space after `Rp` and rejects negatives (signed refund and discount display is decided in M3 Plan); `lib/money` sets no upper rate limit, so M0-BE-06 constraints and the settings schemas do | ALAN, from CARLO's PR #14. The project owner can change them |
| 2026-11-22 | M0-BE-26 merged (PR #13). `turbo run dev` hides the same server variables when they come from the shell, so M0-BE-27 fixes that separately | ALAN, from ADIT's and DAVIN's reports |
| 2026-11-22 | M0-BE-03 gate: a service that is briefly unhealthy while `start` or `db reset` boots it is not a failure if it is healthy when the command returns. Crashes, unexpected restarts, timeouts and unhealthy states outside those commands are | ALAN, from ADIT's evidence |
| 2026-11-22 | M0-BE-04 (PR #7) and M0-BE-19 (PR #14) merged after QA. The real Preview and staging values pass the build's presence and format checks. Not proven: that the credentials work, and the boot check on Vercel, because every route is static so far (retest with the first dynamic route, M0-BE-14). M0-BE-17 exports the PostHog client init, and REYKI mounts it in the Frontend step | ALAN, from DAVIN's QA and the Vercel builds |
| 2026-11-22 | M0-BE-28: `core-js` install script blocked (`false`). It only prints a banner, and pnpm 12 fails an install with an undecided script | ALAN, from CARLO's report |
| 2026-11-22 | M0-BE-29: an explicit-grant baseline is the first migration, before any table. Every later migration grants what it needs. DAVIN pins it in pgTAP in the QA step | ALAN, from ADIT's report |
| 2026-11-22 | Auth's redirect check accepts loopback IPs, and any port on a loopback Site URL, whatever the allow list says. The M0-BE-03 gate expects that. M0-BE-20 validates `next` itself, and M0-FE-10's `token_hash` links are built on the Site URL, never on a caller's redirect host | ALAN, from ADIT's gate and the GoTrue v2.198.0 source |
| 2026-11-22 | Correction to the M0-BE-03 gate row: CLI 3.2.0's `db reset` never waits for the health of the services it restarts, so they must be healthy within 60 seconds after it returns (`start` is unchanged: healthy at return). Scripts and tests that use Auth, Storage or Realtime straight after a reset wait for health first (M0-QA-01) | ALAN, from ADIT's evidence and the CLI source |
| 2026-11-22 | Final M0-BE-03 health rule, replacing the two rows on it above: CLI 3.2.0's `start` gates Postgres on a connection, not on Docker's health label. For `start` and `reset` alike: exit 0, a real query answers within 5 seconds at return, and every service is healthy within 60 seconds. Crashes, out-of-memory kills, unexplained restarts and timeouts fail. Run 4 stays red under the old rule. A red under this rule is a defect or an environment limit, and the rule is not loosened again | ALAN, from run 4 and the CLI source |
| 2026-11-22 | M0-BE-17 merged after QA (PR #21). Error messages are never sent; event values, route words and query values are allow-lists (a new static route or event is added in `lib/analytics` first); no host means analytics is off. Accepted S4: a stack frame's file name under `_next/static` is sent as it is, as real ones are build hashes. Not proven: real PostHog ingestion and delivery on Vercel, Firefox and Safari. REYKI mounts it in `apps/web/instrumentation-client.ts` and measures the bundle (about 35 KB gzip) | ALAN, from CARLO's PR and DAVIN's QA |
| 2026-11-22 | The Supabase stack needs about 6 GB of sandbox memory: it passed there and failed on 2 GB. M0-BE-03 merges only after DAVIN's full repeat. M0-BE-29 is stacked on it meanwhile and merges after it | ALAN, from ADIT's and DAVIN's runs |
| 2026-11-23 | M0-BE-03 (PR #9) and M0-BE-29 (PR #24) merged after DAVIN's PASS on a 6 GB sandbox. "Healthy within 60 seconds" is measured from when `start` or `db reset` returns, not over the whole command, which takes 70 to 110 s when images are cached. `seed.sql` doesn't exist yet, so the CLI prints a "no files matched" notice; M0-BE-13 adds it. M0-BE-05 onward grant explicitly and minimally on every new object, and DAVIN pins the baseline in pgTAP in M0-QA-01 | ALAN, from DAVIN's QA |
| 2026-11-23 | M0-BE-05 to 12, 14, 16 and 18 merged after DAVIN's QA (PRs #27-#37). QA findings rated S4 were routed into the next task that touches the same code instead of reopening merged PRs, and each is written into that task | ALAN |
| 2026-11-23 | Stacked PRs: after the lower PR is squash-merged, the upper one is replayed onto main with `git rebase --onto origin/main <lower head>`, not by merging main in, and goes back to QA only when its own files changed | ALAN, from the #34/#36/#37/#38 conflicts |
| 2026-11-23 | Supabase client deadlines (M0-BE-14/15): Auth calls 2.5 s, after which an Auth outage reads as "unavailable" (never "signed out"); database, storage and function calls 10 s per call, never aborting each other. Access-layer lookups use `'use cache: private'`, not shared `'use cache'`, because the database functions answer for the caller's JWT | ALAN, from DAVIN's outage tests and CARLO's design |
| 2026-11-23 | Arcjet bot rule allows search engines, previews, Slack and social unfurlers, monitors and Vercel. Login per-IP limit is 60 per 15 min because a venue's devices share one IP; per-email limits stop guessing | ALAN |
| 2026-11-23 | Generated database types are checked in CI (regenerate after reset, fail on diff) | ALAN, from DAVIN's #38 QA |
| 2026-11-23 | Staging database live: M0-BE-24 (PR #41) deploys migrations after CI on `main` (tip or ancestor; skips if staging is already ahead), and the first runs applied the 10 M0 migrations and the staging seed. ADIT's sandbox now runs the local stack (6 GB, without Studio) | ALAN |
| 2026-11-23 | M0-BE-20 QA: auth email templates with `token_hash` links are M0-FE-10's (REYKI, with ADIT's `config.toml` wiring in a paired PR); until then the end-to-end confirmation link is not expected to sign the user in. Accepted: sign-out sits behind the proxy's shield and bot rules (real browsers pass); `/auth/confirm` redirects on the request origin (fine on Vercel) | ALAN, from DAVIN's QA |
| 2026-11-23 | M0 Backend step closed: M0-BE-01 to 32 merged after DAVIN's QA. Added during the step: M0-BE-30 (staff/role writes as definer RPCs, so the database guards see the caller), M0-BE-31 and M0-BE-32 (the reads and the invitation preview REYKI's contract check found missing). M0-BE-23 moved from CARLO to ADIT: the board listed ADIT and ADIT started it while CARLO was on M0-BE-22; it kept one owner and no shared files | ALAN |
| 2026-11-23 | Contracts (`docs/contracts/`) are the frontend's source of truth for M0. A page without the needed permission shows a notice and hides its nav entry (not a 404). The invitation email is bilingual (EN and ID) with escaped values. Timezone pickers offer canonical IANA names only, Indonesian zones first | ALAN, with REYKI and CARLO |
| 2026-11-24 | Motion libraries added to the design system (`DESIGN.md` §4.5.1–4.5.3): Motion for component motion on every surface; GSAP (`ScrollTrigger`) and Lenis smooth scroll on marketing pages only; never in admin, super admin, POS, KDS, auth or the storefront scroll. Reduced motion, server-rendered final state, client islands and a bundle check are required. Set up in M0-FE-02 (Motion) and M0-FE-09 (GSAP + Lenis) | Project owner, via ALAN |
| 2026-11-24 | Storefront placeholder lives at `/s/[slug]` in M0 (M0-FE-09). The proxy only tags tenant hosts with `x-restomate-tenant` and does not rewrite, and staging has no custom domain, so tenant subdomains are local-only until M4. M4-BE-01 adds the tenant-host rewrite to `/s/<slug>` and the 404 for `/s/*` on other hosts. The starter `app/page.tsx` is removed; the marketing home serves `/` | ALAN, from REYKI's #65 |

### Open

| Decision | Settle in |
|---|---|
| Plan pricing and yearly discount | M1-LD-01, final in M6-LD-01 |
| POS printers and cash drawers | M3-LD-02 |
| Tipping at launch | M3-LD-02 |
| Configurable or fixed KDS thresholds | M3-LD-03 |
| Confirm the rounding default for tax and service charge, and how refunds and discounts show a minus sign | M3 Plan, before M3-BE-09 |
| DOKU merchant onboarding | M5-LD-01 |
| Email only or WhatsApp at launch | M6-LD-01 |
| E-Faktur for subscription invoices | M6-LD-01 |
| PostHog project setting that discards client IPs is on (project owner) | Before M0's Frontend step mounts analytics |
| Consent for analytics (legal, project owner) | Before public launch |
| `all_locations` invitations copy today's locations at accept time, so later locations don't reach that member (likely an `all_locations` flag on `organization_members`) | M2 Plan, before locations can be created in the app |
| Deleting a location removes it from invitation lists without an audit row | M2 Plan, with location management |
| Access token lifetime: after a password reset, other devices' access JWTs stay valid until they expire (`jwt_expiry` 3600 s). Shorten it, or check the session server-side for sensitive actions | M6 production readiness |
| Storefront analytics: a tenant's subdomain reaches PostHog in the `Origin` header (reverse proxy, or none on storefronts) | M4 Plan |

### `instant = false` opt-outs

| Route | Reason | Task to remove it |
|---|---|---|
| None | — | — |
