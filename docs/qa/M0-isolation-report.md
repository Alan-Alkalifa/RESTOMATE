# M0-QA-02 Isolation report: PASS (pgTAP, local)

| | |
|---|---|
| Task | MF-T37 M0-QA-02 Isolation |
| Commit tested | stack top `31c0c92` + #70 (`mf-t36-test-base`) + this branch |
| Environment | Supabase CLI 3.2.0 local stack, `pnpm db:reset` then `pnpm db:test` |
| Date / tester | 2026-11-24 / DAVIN |

## Result
PASS. `supabase/tests/tenant_isolation.test.sql`: 186 assertions, all pass. Whole suite: 14 files, 1074 tests, PASS.

## Exit criterion: "every cross-tenant attempt fails"
| Check | Count | Result |
|---|---|---|
| Fixture: tenants A and B each have rows in all 11 tenant tables | 1 | PASS |
| `anon`: select, insert, update, delete on all 18 `public` tables | 72 | PASS (all `42501`) |
| Member of A against B on the 11 tenant tables: read, insert, update, delete | 44 | PASS |
| Member of B against A, same | 44 | PASS |
| Positive controls: A sees own rows in 8 tables; 3 tables have no member select grant | 11 | PASS |
| `profiles`: B's owner cannot read or change A's owner's profile | 2 | PASS |
| User in no organization sees neither tenant (11 tables) and no other profile | 12 | PASS |

Tenant tables covered: audit_logs, location_staff, locations, org_branding, organization_members, organizations, role_permissions, roles, staff_invitation_locations, staff_invitations, subscriptions. Reference and platform tables (default_role_permissions, packages, permissions, platform_admins, platform_settings, reserved_slugs) are covered by the `anon` block and the privilege baseline; no member of any tenant has any grant on them.

## The test can fail (mutation check)
Applied four deliberate breaks to a copy of the schema and re-ran the file: a `using (true)` select policy on `locations`, open write grants and policy on `roles`, a `using (true)` select policy plus grant on `subscriptions`, and `grant select on packages to anon`. Result: 15 of 186 failed, naming each table (`anon cannot select from packages`, `A cannot read B rows in locations/roles/subscriptions`, `A cannot insert a B row into roles`, `A cannot delete B rows in roles`, and the matching B and outsider lines). Database rolled back and the extension dropped afterwards.

## Not verified / limits
- Writes: today `authenticated` has no insert, update or delete grant on any tenant table, so writes are denied at the privilege layer. The RLS write policies are not exercised because none exist yet. When a milestone adds a write policy or grant, the file fails on purpose (an `err:` result is not accepted) and the new path needs its own test with real values.
- The `roles` update probe ran against system roles only, which the M0-BE-08 guard protects even when RLS is opened (the mutation above did not trip that line). Custom-role writes are covered by ADIT's `roles.test.sql` and `staff_rpcs.test.sql` (RPC path).
- RPC-level cross-tenant attempts (create location, invite, change role as a member of another org) are in ADIT's `rpcs`, `staff_rpcs`, `guards` and `invitation_slots` files; M0-QA-03 (Abuse) re-checks them from the Playwright side where relevant.
- Tables added after M0 are not auto-enumerated for the 11-table list; the `anon` block is (it reads the catalog). Add new tenant tables to `pg_temp.tenant_tables()`.
