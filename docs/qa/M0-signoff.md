# M0 sign-off (M0-QA-05)

| | |
|---|---|
| Milestone | M0 Foundation |
| Tester | DAVIN |
| Date | 2026-11-24 |
| Tested | the M0 stack top `d09f495` (#56 to #69), plus the QA branches #70 to #74 and this one, which add tests and docs only |
| Environment | local Supabase 3.2.0 (Auth with the themed templates, Mailpit), Next.js 16.4.6, Chromium; projects `desktop` (1440x900) and `tablet` (1280x800, touch). Production build checked once for BUG-005 and the bundle split |

## Verdict

**The four acceptance lines and the M0 exit pass. The overall verdict is HELD: one required check is still open** (live rate-limit refusal on a preview, see section 4). ALAN's rule: not PASS without it. No S1 or S2 bug is open in the product (BUG-007 is an S2 in CI, see section 5).

| Line | Verdict |
|---|---|
| 4.9.1 Invite staff by email; they set their own password | PASS |
| 4.9.2 Default roles; owners create custom roles from a permission checklist | PASS |
| 4.9.3 Staff limited to specific locations | PASS |
| 4.9.6 Deactivating a staff member signs them out everywhere | PASS |
| Exit: sign up, create a restaurant, invite a Cashier, with full tenant isolation | PASS |
| Live rate-limit refusal on a preview (login, slug check; resend after merge) | **OPEN** |

## 1. Acceptance lines

### 4.9.1 Invite staff by email; they set their own password: PASS
- **Journey** (`apps/web/e2e/onboarding-journey.e2e.ts`, desktop 41.6 s, tablet 39.4 s): the owner invites an address through the Staff screen ("Invitation sent.", the invitation is listed as Pending). A second browser opens the invitation link, sees "Join QA E2E Restaurant" and "You're invited as Cashier.", chooses to create an account with the invited address and **picks their own password in the signup form**, confirms by mail, presses "Accept invitation" and lands in the restaurant.
- **The known-token limit, as accepted by ALAN for M0:** the journey accepts through a second invitation created with the same `create_staff_invitation` RPC and a token the test knows. The known-token limit is accepted for M0, because `acceptInvitationUrl` and the themed renderer are unit-tested and `EMAIL_DELIVERY=log` rightly doesn't print the token.
- **The email itself** (`apps/web/e2e/invitation-email.e2e.ts`; files in `docs/qa/evidence/invitation-email/`): the real renderer was run with sample values including an organisation name that needs escaping (`Warung "Sedap" <Rasa> & Co`), opened in a browser at 390 px and 1280 px, and screenshotted (`mobile-en.png`, `mobile-id.png`, `desktop-en.png`, `desktop-id.png`, plus full pages, the HTML and the plain text). Checked: English then Bahasa Indonesia in one message; the name shows as text and no `script` or `img` element exists; the button's link equals the real `acceptInvitationUrl(token)` (the spec imports the actual function; the run reported "acceptInvitationUrl()" as the link source); no horizontal scroll at either width; the text part has the link in both languages.
- **Wrong-email invitation** (`invitation-links.e2e.ts`, both projects): signed in as another account, "Accept invitation" shows "You're signed in with a different email" and the page text never contains the invited address or its local part; "Sign out and use the invited address" returns to `/login` with the invitation as the next step, and after signing in with the invited address the invitation page returns and Accept works.
- **Other bad links** (same file): no token, a malformed token, an unknown token, a revoked token and an expired token each show the same "This invitation link doesn't work" page, with byte-identical text and no organisation name or address.
- **Abuse** (`supabase/tests/abuse.test.sql`, 58 assertions): reused, expired, revoked, unknown, wrong-case and unconfirmed-email tokens are refused with the exact code; the preview returns one identical answer for dead tokens and never the email or an id (`docs/qa/M0-abuse-report.md`).
- **Resend limit:** BUG-003 (resend and invite had no limit) is fixed in #73 (code and unit tests PASS). **Verified after merge: real Resend delivery and the resend rate limit (4 resends to one address) on staging right after Close. Owner: DAVIN. Date: to be written here when done.**

### 4.9.2 Default roles and custom roles: PASS
`apps/web/e2e/roles-and-locations.e2e.ts` (both projects):
- A new restaurant lists the five built-in roles (Owner, Manager, Cashier, Waiter, Kitchen, each marked Built-in); on the default trial plan custom roles are locked ("Custom roles are locked", the Create role button is disabled).
- On a plan that includes custom roles (Growth) the owner opens Create role, names it, ticks permissions from the checklist (more than five listed) and creates it: "Role created.", listed as Custom.
- Database level: ADIT's `roles`, `rpcs` and `staff_rpcs` files (in the 15-file pgTAP suite) and the escalation and plan-feature cases in `abuse.test.sql` (`ESCALATION_DENIED`, `PLAN_FEATURE:custom_roles`).
- Note: custom roles are a plan feature; the trial plan locks them by design. The test moves the plan with SQL before the first page visit because the app caches the plan per restaurant (platform plan changes arrive in M1).

### 4.9.3 Staff limited to specific locations: PASS
`roles-and-locations.e2e.ts` (both projects): a restaurant with two locations ("Main", "Second"); a Cashier invited for Main only and accepted. Read through the same API the app uses, the Cashier sees `["Main"]` and the owner sees `["Main", "Second"]`; the owner's Staff list shows the member with Main and not Second. Database level: ADIT's `access_helpers`, `guards` and `staff_rpcs` files (location access, `LOCATION_INVALID`), and the isolation suite.

### 4.9.6 Deactivating a staff member signs them out everywhere: PASS
`onboarding-journey.e2e.ts` (both projects), after the owner deactivates the member, from the Cashier's side:
1. the restaurant no longer opens: "Your access was removed";
2. the refresh token the browser held before can no longer get a new access token;
3. the access token already issued reads no `locations` rows.

**Why there is no forced redirect to `/login` (decision by ALAN, to be logged in PLAN.md at close):** deactivation is per organisation. A redirect to `/login` would also cut off the person's other restaurants. Sessions are deleted and refresh is revoked immediately, every request re-checks membership, and the token left in the browser reaches no data until it expires. The "Your access was removed" screen is the intended outcome. Residual: that token still counts as a signed-in user to Supabase until its expiry (default one hour).

## 2. M0 exit: sign up, create a restaurant, invite a Cashier, with full tenant isolation: PASS
- **Journey:** `onboarding-journey.e2e.ts`, signup, confirm through Mailpit (themed mail, `/auth/confirm?token_hash=…&type=signup`), create restaurant, invite a Cashier, accept, deactivate: desktop and tablet (`docs/qa/M0-e2e-report.md`).
- **Isolation:** `supabase/tests/tenant_isolation.test.sql`, 186 assertions: two tenants, all 11 tenant tables, select, insert, update and delete across tenants in both directions, `anon` on all 18 public tables, a user in no organisation, positive controls, profiles. A mutation run with four deliberate breaks fails 15 of them (`docs/qa/M0-isolation-report.md`). Limit: write isolation is proven at the privilege layer because no tenant table has a write grant yet; the file fails on purpose when one appears.
- **Privilege baseline:** `privilege_baseline.test.sql`, 42 assertions, fails when default privileges are re-granted.
- **Abuse:** `abuse.test.sql`, 58 assertions, escalation, cross-tenant, last owner, plan limits, invitations, slugs (`docs/qa/M0-abuse-report.md`).
- **Totals, local:** pgTAP 15 files, 1132 tests, PASS (the CI Database job passes on #70 and #74). Playwright, full suite on both projects: 36 tests, 34 passed, 2 failed (both BUG-006, marketing reduced motion).

## 3. The checks ALAN listed for the frontend step

| Check | Result | Evidence |
|---|---|---|
| Emails end to end: signup mail to `/auth/confirm` to signed in | PASS | journey; mail is themed, subject "Confirm your email / Konfirmasi email Anda", link carries `token_hash` |
| Recovery mail to `/reset-password` signed in | PASS | `recovery.e2e.ts`: mail has `token_hash` and `type=recovery`, subject "Reset your password / …"; new password works, old one no longer does |
| Staff invitation email is the themed bilingual one | PASS (rendered) | section 1, 4.9.1; real delivery after merge on staging |
| Wrong-email invite, generic bad links | PASS | section 1, 4.9.1 |
| `#65` bundle: gsap and lenis only in marketing chunks | PASS | production build: gsap is in chunk `2gz1hjvmvff1_.js` and lenis in `2vifqmlsix5q9.js`; only the `/` route's first-load list and client manifest reference them, none of `/app`, `/app/[slug]` (and its roles and staff), `/admin`, `/s/[slug]`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/invite/accept`, `/create-restaurant` |
| DESIGN 4.5: reduced motion on modals, sheets, toasts | PASS | `reduced-motion.e2e.ts`: no frame-by-frame movement for the modal, sheet or toast with reduced motion; the modal control moves when motion is allowed (with reduced motion Motion snaps the offset while the element is still transparent) |
| DESIGN 4.5: marketing page has no smooth scroll | **FAIL (BUG-006, S3)** | Lenis still takes over the wheel with reduced motion (control confirms the check can tell); its `respectReducedMotion` only affects programmatic scrolls |
| Storefront placeholder at `/s/[slug]`, suspended notice | PASS | `storefront.e2e.ts`: restaurant name and "Online ordering opens soon."; unknown address shows nothing of another restaurant; after suspension "Temporarily unavailable" and the name is gone |
| `/` and `/app` chooser no longer throw (BUG-001) | PASS | `smoke` and `app-chooser` specs |

## 4. Live rate limit on a preview: OPEN
Required by ALAN before the verdict: login limit, slug-check limit (and resends, moved to after merge).
- **Preview used:** `dpl_JsJzkaWkkAAaWYYSWSnSnRnbPH3J` (branch `mf-t39-e2e`, `bf46516`; app code is the stack top).
- **Observed live:** the preview's Arcjet bot rule is enforcing. Every request from the automated browser gets the proxy's bare `403 Forbidden` before any page (`e2e/live-rate-limit.e2e.ts`, test "bot protection", passes).
- **Not verified:** the login limit (5 per address per 15 minutes) and the slug-check limit (30 per signed-in user per 10 minutes) cannot be reached from automation, because the same rule blocks the login page. A normal user-agent string did not change that, and I stopped there rather than fake client signals to defeat a protection. The slug check also needs a confirmed account on the preview.
- **Decision requested from ALAN:** (a) a human runs it by hand on the preview, steps in the message sent with this document; (b) a sanctioned QA path in the Preview-only Arcjet rule, then `live-rate-limit.e2e.ts` runs as written; or (c) accept the unit-tested presets (413 tests) plus the live bot-rule evidence for M0, and verify the limits on staging after Close.
- Unit-level evidence that does exist: all presets pass their Vitest suites (`lib/arcjet`, `lib/actions`); the invitation-send preset in #73 was code-read (order: validate, authorise, limit, RPC, email).

## 5. Bugs

| ID | Sev | Task, owner | Status |
|---|---|---|---|
| BUG-001 Server components call `buttonClasses()` from a client module (`/` and the `/app` chooser) | S2 | MF-T34, REYKI | Closed, retested PASS on `d09f495` (both pages) |
| BUG-002 `randomUUID` prerender error | n/a | MF-T17 | Not needed: it disappeared with BUG-001 |
| BUG-003 Invitation resend has no limit and mails the invitee | S3 | MF-T22, CARLO | Fixed in #73; retest PASS on code and unit tests; live refusal after merge (owner DAVIN) |
| BUG-004 `Date.now()` prerender warning in `next dev` for `/app`, `/app/[slug]`, `/create-restaurant` | S4 | MF-T31, REYKI | Deferred to M1; not seen on a preview or production build (not run) |
| BUG-005 Restaurant name cleared when typed before hydration | S4 | MF-T30, REYKI | Dev only: 0 of 12 production attempts (6x and 20x CPU throttle) lost it, 2 of 6 in dev. Planned for M1 |
| BUG-006 Marketing page still smooth-scrolls the wheel with reduced motion | S3 | MF-T34, REYKI | Open, routed |
| BUG-007 CI E2E job is cancelled in "Install browsers" (15-minute timeout) | S2 (CI) | MF-T02, ADIT | Open, routed |

PASS requires no open S1 or S2 in the product: none. BUG-007 is an S2 in CI, not in the app; until it is fixed the Playwright suite is not gated in CI (the Database job, with all pgTAP files, is). BUG-006 and BUG-007 together make the E2E job red after BUG-007 is fixed, until BUG-006 is.

## 6. Not verified, with owners
- Live rate-limit refusals (login, slug check): see section 4. Owner DAVIN with ALAN's decision.
- Real Resend delivery of the invitation and the resend rate limit (4 resends to one address, #73): staging after Close. Owner DAVIN, date to be added here.
- Concurrency races on limits and on the last owner: not required for M0.
- Production build and preview checks of BUG-004; real device sizes (the tablet project is an emulated 1280x800 touch viewport).
- The Playwright suite in CI (BUG-007).

## 7. Rerunning
`docs/qa/README.md` has the commands. In short: `pnpm db:stop && pnpm db:start` (restart after any `supabase/config.toml` change; `pnpm exec supabase start -x studio,imgproxy` on a 6 GB machine), `pnpm db:reset`, `pnpm db:test`, export the local keys, `pnpm test:e2e`. Opt-in diagnostics: `E2E_HYDRATION_RACE=1` (BUG-005), `E2E_LIVE_SHARE_URL` and friends (live protection).
