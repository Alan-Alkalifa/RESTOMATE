# M0-QA-04 End to end report: PASS (desktop and tablet, local)

| | |
|---|---|
| Task | MF-T39 M0-QA-04 End to end |
| Commit tested | stack top `d09f495` + #70 + #71 + #72 + this branch |
| Environment | local Supabase (Auth with the themed templates from `supabase/config.toml`, Mailpit), `next dev`, Chromium. Projects `desktop` (1440x900) and `tablet` (1280x800, touch). `ARCJET_KEY` and `RESEND_API_KEY` blanked, `EMAIL_DELIVERY=log` |
| Date / tester | 2026-11-24 / DAVIN |

## Result
`pnpm test:e2e`: 8 passed on both projects (2.3 min). The M0 exit journey passes on desktop (41.6 s) and tablet (39.4 s).

## Exit criterion: signup, confirm, create restaurant, invite Cashier, accept, deactivate
`apps/web/e2e/onboarding-journey.e2e.ts`, one run per project, all through the real screens:

| Step | What is asserted | Result |
|---|---|---|
| Signup | `/signup` form, "Check your email" screen | PASS |
| Confirm | the mail in Mailpit has a link to `/auth/confirm?token_hash=…&type=signup` (themed, subject "Confirm your email / Konfirmasi email Anda"); opening it signs the user in and lands on "Set up your restaurant" | PASS |
| Create restaurant | slug check answers "available", the restaurant is created, the browser lands on `/app/<slug>` | PASS |
| Invite Cashier (UI) | Staff, Invite staff dialog, role Cashier, all locations, "Invitation sent."; the invitation is listed as Pending | PASS |
| Accept | a second browser opens `/invite/accept?token=…`: "Join QA E2E Restaurant", "You're invited as Cashier."; Create an account with the invited address, confirm by mail, "Accept invitation", lands on `/app/<slug>` | PASS |
| Deactivate | the owner sees the member, Deactivate, confirm, "Team member deactivated." | PASS |
| 4.9.6 signed out everywhere (Cashier side) | (a) `/app/<slug>` shows "Your access was removed"; (b) the refresh token from before no longer refreshes; (c) the access token from before reads no `locations` rows | PASS |

Also in the suite: `/` renders with the hero link to `/signup` (BUG-001), and an account with two restaurants gets the chooser at `/app` (BUG-001, second page), on both projects.

## Notes that affect how to read this
- **The app's invitation email cannot be read locally.** With `EMAIL_DELIVERY=log` the app logs one metadata line (kind, id, outcome), never a body or link, and `resend` is the only other mode, so nothing reaches Mailpit. The journey therefore invites the first address through the UI (proving the action, dialog and list) and accepts with a second invitation created through the same `create_staff_invitation` RPC with a token the test knows (43-character base64url, as the app issues). **Not verified: the content and look of the themed, bilingual invitation email, and that the link in a real email matches `acceptInvitationUrl`.** Needs a preview with Resend, or a render test; to be decided with ALAN before T40.
- **4.9.6 wording.** The deactivated Cashier is not redirected to `/login`: the restaurant shows "Your access was removed" and offers "Go to my restaurants". The server deletes their sessions, so nothing can be refreshed, and every request re-checks membership, but the access token already in their browser stays valid until it expires (Supabase's default is one hour) and still reads as a signed-in user to Supabase. No restaurant data is reachable with it (check c). Reported for ALAN's decision, not as a bug.
- **Stack restart.** The first runs failed because the stack had been started before the email templates existed: `db:reset` does not reload Auth, so confirmation mail carried Supabase's default `/auth/v1/verify` link. Restarting the stack fixed it; the lesson is in `docs/qa/README.md`.
- **Hydration race in `next dev`.** Typing the restaurant name before the form hydrated cleared it once (the screen then showed "This field is required."). The test waits for the slug check (which needs a hydrated form) before typing the name. A real user typing instantly after load could hit the same thing in dev; I have not seen it on a production build and have not tried one.
- BUG-004 (`Date.now()` prerender warning, deferred to M1, S4) shows in the server log of every run; no test failed because of it. Not seen on a preview or production build, which were not run.
- Environment: Studio was excluded from the local stack (`-x studio,imgproxy`, it times out its health check at about 6 GB). Nothing under test uses it.

## Not verified
- Recovery (`/forgot-password` mail, `/reset-password`), wrong-email invitation page, the gsap/lenis bundle split, reduced motion, and the `/s/[slug]` placeholder: listed by ALAN for M0 and not part of this journey; they go in the T40 sign-off.
- A production build and a Vercel preview (deploy quota).
- Real device sizes: the tablet project is a 1280x800 touch viewport in Chromium, not a physical 10" tablet.
