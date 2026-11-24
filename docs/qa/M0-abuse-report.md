# M0-QA-03 Abuse report: PASS for the database rules, PARTIAL for the rate limit

| | |
|---|---|
| Task | MF-T38 M0-QA-03 Abuse |
| Commit tested | stack top `31c0c92` + #70 + #71 + this branch |
| Environment | Supabase CLI 3.2.0 local stack; `pnpm db:test`; Vitest for the Arcjet presets |
| Date / tester | 2026-11-24 / DAVIN |

## Result
`supabase/tests/abuse.test.sql`: 58 assertions, all pass, each with the exact error code the server maps. Whole pgTAP suite: 15 files, 1132 tests, PASS.
The rate limit is configured and unit-tested but its live enforcement is **not verified** (see below). One abuse path without a limit was found: BUG-003 (S3).

## Exit criterion: "each is refused"
| Abuse case | Attack | Refused with | Result |
|---|---|---|---|
| Escalation | manager invites an Owner; promotes self or another to Owner; deactivates or demotes an Owner; builds a role with a permission they lack | `ESCALATION_DENIED` (42501) | PASS |
| Escalation | cashier invites, promotes self, deactivates a manager, edits own locations; waiter creates a role | `FORBIDDEN` (42501) | PASS |
| Cross-tenant | owner of B changes, deactivates, invites into, or deletes a role of A; invites into B with a role of A; reads A's plan | `FORBIDDEN`, `ROLE_INVALID`, or no rows | PASS |
| Last owner | only owner deactivates or demotes self through the RPCs | `ESCALATION_DENIED` (RPCs refuse self-targeting) | PASS |
| Last owner | the trigger, for any writer that skips the RPCs: deactivate or demote the only owner | `LAST_OWNER` (P0001) | PASS |
| Last owner | delete a member row (API, and postgres) | 42501, `MEMBER_DELETE` | PASS |
| Limits | third person at a staff limit of 2; fourth organization at the cap of 3; custom role without the feature; location straight into the table | `PLAN_LIMIT:staff`, `ORG_CAP`, `PLAN_FEATURE:custom_roles`, 42501 | PASS |
| Wrong-email invite | valid token on the wrong account; token sent to someone else | `INVITATION_EMAIL_MISMATCH`, no membership created | PASS |
| Unconfirmed email | matching address, email never confirmed | `INVITATION_INVALID` | PASS |
| Reused invite | replay by the same person and by another account; second token for the same org | `INVITATION_INVALID`, `ALREADY_MEMBER`; exactly one membership | PASS |
| Expired, revoked, unknown, empty, null, wrong case, extra character | each token | `INVITATION_INVALID` | PASS |
| Preview oracle | unknown, revoked and null tokens look identical (`unavailable`, no names); only name, slug, role, status are returned, never the email or an id; an expired token says `expired` by design | | PASS |
| Slug rules | 2 characters, space, double hyphen, underscore, reserved (`www`), taken, taken in other case | `SLUG_INVALID`, `SLUG_RESERVED`, `SLUG_TAKEN`; no organization left behind | PASS |

## The test can fail (mutation check)
Dropping the `organization_members_guard_update` and `staff_invitations_guard_write` triggers in a rolled-back run makes 9 of 58 assertions fail (invite an Owner, cashier cases, both `LAST_OWNER` trigger cases, the staff limit). The triggers still existed afterwards.

## Rate limit
| Entry point | Limit (Arcjet sliding window) | Unit tests |
|---|---|---|
| login | 60 per IP and 5 per email per 15 min | pass |
| signup | 5 per IP and 3 per email per hour, plus disposable and invalid addresses refused | pass |
| password reset, resend confirmation | 5 per IP and 3 per email per hour | pass |
| slug check | 60 per IP and 30 per user per 10 min | pass |
| create organization | 10 per IP and 5 per user per hour | pass |
| invitation preview | 60 per IP per 10 min | pass |
| proxy | shield, plus bot detection on app hosts | pass |

`pnpm exec vitest run lib/arcjet lib/actions`: 413 passed, 12 skipped (the skipped ones are the integration tests that need the stack).
No Arcjet limit exists on `inviteStaff`, `resendInvitation`, `acceptInvitation` and the role actions; they depend on the database rules above and on sign-in. That gap is BUG-003.

## Not verified
- **Live rate limiting.** Arcjet fails open without a key (by design), so the local stack and CI never refuse a request for rate. Proving the real limits needs a call to Arcjet with a key I may use for QA. This sandbox has an `ARCJET_KEY`, but I do not know whether it is tied to production, so I did not use it, and the e2e web server blanks it. Waiting on ALAN's decision (a dev or test key, or accept the unit tests as the M0 evidence).
- The email sent by `resendInvitation` (read in code, not run).
- Concurrency: two simultaneous requests racing a limit. The code takes advisory and row locks; I have not run a parallel attack.
