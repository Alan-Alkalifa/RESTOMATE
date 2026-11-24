# BUG-003: An invitation can be resent without limit; each resend emails the invitee

(BUG-002 is reserved for the `randomUUID` prerender error from `lib/analytics/server.ts`, pending the BUG-001 retest.)

| | |
|---|---|
| Task ID | MF-T22 (M0-BE-22 Staff actions: `resendInvitation`, `inviteStaff`) |
| PR / commit | merged to `main` earlier (`apps/web/lib/actions/staff/actions.ts`); seen on stack top `31c0c92` |
| Severity | S3: needs a signed-in Owner or Manager; the harm is mail to a third party and the sending domain's reputation, not data. It is the only abuse path found in M0-QA-03 without any limit |
| Owner (PLAN 1.1) | CARLO (action). The RPC `resend_staff_invitation` is ADIT's (M0-BE-30, MF-T45) if a database cooldown is chosen |
| Found by / date | DAVIN / 2026-11-24 |
| Environment | local stack, commit `31c0c92` |

## Steps
1. As the Owner or a Manager of an organization, invite an address (`inviteStaff`).
2. Call `resendInvitation` for that invitation, again and again, using the id of the newest invitation each time.
3. Database-level proof (all 10 accepted back to back, as `authenticated` with a Manager/Owner JWT):
   `resend_staff_invitation(id, new_hash)` called 10 times in a row, chaining the returned id.

## Expected
A resend is limited: a short cooldown per invitation and/or a rate limit per signed-in user and per invitee address (the auth and organization actions already use Arcjet presets; the invitation preview has one too).

## Actual
No limit anywhere on the path:
- RPC: 10 resends in one transaction all succeeded. Result: `10 revoked + 1 open` invitations for the one address.
- Action (`lib/actions/staff/actions.ts`, `resendInvitation`): after each successful RPC it calls `emailInvitation(...)` to the invitee, so each call sends one email. There is no Arcjet preset on `inviteStaff`, `resendInvitation` or `acceptInvitation`.
- The staff plan limit does not help: a resend revokes the old invitation and creates a new one, so the number of open invitations never grows. Invite, revoke, invite again has the same effect.

## Evidence
- Probe appended to a copy of `supabase/tests/abuse.test.sql` and run in a rolled-back transaction: `PROBE: 10 resends accepted; invitations for one address: 10 revoked + 1 open`.
- Not exercised: the email send itself (the action's `emailInvitation` call was read, not run, because the e2e stack sends to Mailpit and this was a database-level probe).

## Suggested direction (CARLO and ALAN decide)
An Arcjet preset for invitations (per signed-in user and per invitee address, like `AUTH_LIMITS`), and/or a cooldown column checked in `resend_staff_invitation`.

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
| 2026-11-24 | PR #73 `d1cbf42` (MF-T52, base `main`) | PASS on code and unit tests. Code read of `lib/actions/staff/actions.ts`: in both `inviteStaff` and `resendInvitation` the order is validate, `managerOf` (sign-in and permission), `limitInvitationSend`, then the RPC, then the email, so a refused request neither writes nor mails. `protectInvitationSend`: 30 per hour per user (`userKey`) and 3 per hour per invitee (`emailKey` of the NFKC-normalized, trimmed, lowercased address, so case does not matter and it spans organizations and senders); keys are HMACs, no raw ID or address leaves the server; fails open with a logged code. `vitest run lib/arcjet lib/actions/staff`: 12 files, 186 tests pass. **Not verified: a live refusal** (fails open without a key). To be checked on a Vercel preview with the project's own Preview key, together with the login and slug-check limits, before T40 | `inviteStaff` and `resendInvitation` unit tests (in the 186) |
