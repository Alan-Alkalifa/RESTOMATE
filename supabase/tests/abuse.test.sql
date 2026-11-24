-- M0-QA-03: abuse cases, from the attacker's side.
--
-- Every attack goes through the public surface only: the RPCs, called as `authenticated` with a real
-- JWT subject. The fixture is built as postgres. One attack, one assertion, with the exact error code the
-- server maps (errors are stable codes in the message). ADIT's rpcs, staff_rpcs and guards files test the
-- mechanics; this file is the checklist from PLAN M0-QA-03:
--   escalation, last owner, limits, reused / expired / wrong-email invitations, slug rules.
-- The rate limit is not a database rule: it is in e2e (Arcjet) and in docs/qa/M0-abuse-report.md.
begin;
select plan(58);

create function pg_temp.hash(p text) returns bytea language sql as $$ select sha256(convert_to(p, 'UTF8')); $$;
create function pg_temp.uuid_of(n int) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$$;
create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uuid_of(n), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.no_user() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create function pg_temp.org(p_slug text) returns uuid language sql as $$ select id from public.organizations where slug = p_slug; $$;
create function pg_temp.role(p_slug text, p_key text) returns uuid language sql as $$
  select id from public.roles where org_id = pg_temp.org(p_slug) and system_key = p_key;
$$;
create function pg_temp.member(p_slug text, p_user int) returns uuid language sql as $$
  select id from public.organization_members where org_id = pg_temp.org(p_slug) and user_id = pg_temp.uuid_of(p_user);
$$;
create function pg_temp.add_member(p_slug text, p_user int, p_key text) returns void language sql as $$
  insert into public.organization_members (org_id, user_id, role_id) values (pg_temp.org(p_slug), pg_temp.uuid_of(p_user), pg_temp.role(p_slug, p_key));
$$;
-- An open invitation to p_email with a known plaintext token.
create function pg_temp.invite(p_slug text, p_email text, p_key text, p_token text, p_expires interval default interval '2 days') returns void language sql as $$
  -- A past expiry needs a past created_at: the table requires expires_at after created_at.
  insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at, created_at)
  values (pg_temp.org(p_slug), p_email, pg_temp.role(p_slug, p_key), pg_temp.hash(p_token), now() + p_expires, least(now(), now() + p_expires - interval '1 day'));
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixture
-- Users: 1 owner of A, 2 manager of A, 3 cashier of A, 4 waiter of A, 5 owner of B,
--        6 invitee (confirmed), 7 invitee (confirmed, other address), 8 invitee (email NOT confirmed),
--        9 owns three organizations (the cap), 10 owner of the plan-limit org.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select pg_temp.uuid_of(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'abuse' || n || '@example.test', case when n = 8 then null else now() end
from generate_series(1, 11) n;

insert into public.packages (key, name, max_locations, max_staff, max_tables, feature_custom_roles) values ('abuse_test', 'Abuse test', 5, 20, 20, true), ('abuse_tiny', 'Abuse tiny', 1, 2, 5, false);
insert into public.organizations (name, slug) values ('Abuse A', 'abuse-a'), ('Abuse B', 'abuse-b'), ('Abuse Tiny', 'abuse-tiny');
insert into public.subscriptions (org_id, package_id, status)
select o.id, p.id, 'active' from public.organizations o join public.packages p on p.key = case when o.slug = 'abuse-tiny' then 'abuse_tiny' else 'abuse_test' end
where o.slug in ('abuse-a', 'abuse-b', 'abuse-tiny');
insert into public.locations (org_id, name) values (pg_temp.org('abuse-a'), 'One'), (pg_temp.org('abuse-b'), 'Bee');

select pg_temp.add_member('abuse-a', 1, 'owner');
select pg_temp.add_member('abuse-a', 2, 'manager');
select pg_temp.add_member('abuse-a', 3, 'cashier');
select pg_temp.add_member('abuse-a', 4, 'waiter');
select pg_temp.add_member('abuse-b', 5, 'owner');
select pg_temp.add_member('abuse-tiny', 10, 'owner');
select pg_temp.add_member('abuse-tiny', 11, 'cashier');

-- Open invitations with known plaintext tokens.
select pg_temp.invite('abuse-a', 'abuse6@example.test', 'cashier', 'tok-good');
select pg_temp.invite('abuse-a', 'someone-else@example.test', 'waiter', 'tok-wrong-email');
select pg_temp.invite('abuse-a', 'abuse8@example.test', 'cashier', 'tok-unconfirmed');
select pg_temp.invite('abuse-a', 'abuse7@example.test', 'cashier', 'tok-expired', interval '-1 minute');
select pg_temp.invite('abuse-a', 'revoked-person@example.test', 'kitchen', 'tok-revoked');
update public.staff_invitations set revoked_at = now() where token_hash = pg_temp.hash('tok-revoked');

-- User 9 already owns ORG_CAP organizations.
insert into public.organizations (name, slug) values ('Nine 1', 'nine-one'), ('Nine 2', 'nine-two'), ('Nine 3', 'nine-three');
insert into public.subscriptions (org_id, package_id, status)
select o.id, (select id from public.packages where key = 'abuse_test'), 'active' from public.organizations o where o.slug in ('nine-one', 'nine-two', 'nine-three');
select pg_temp.add_member(s, 9, 'owner') from unnest(array['nine-one', 'nine-two', 'nine-three']) s;

grant execute on function pg_temp.hash(text), pg_temp.uuid_of(int), pg_temp.as_user(int) to authenticated;

-- A's own data an attacker will aim at, and B's.
create temp table ids on commit drop as select
  pg_temp.member('abuse-a', 1) as a_owner, pg_temp.member('abuse-a', 2) as a_manager, pg_temp.member('abuse-a', 3) as a_cashier,
  pg_temp.member('abuse-b', 5) as b_owner, pg_temp.org('abuse-a') as a_org, pg_temp.org('abuse-b') as b_org,
  pg_temp.role('abuse-a', 'owner') as a_owner_role, pg_temp.role('abuse-a', 'manager') as a_manager_role,
  pg_temp.role('abuse-b', 'cashier') as b_cashier_role, pg_temp.org('abuse-tiny') as tiny_org, pg_temp.role('abuse-tiny', 'cashier') as tiny_cashier_role;
grant select on ids to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Escalation (privilege and tenant)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(2); -- manager of A: staff.manage, but not Owner
select throws_ok(format($q$select public.create_staff_invitation(%L, 'esc1@example.test', %L, pg_temp.hash('esc1'), true, null)$q$, (select a_org from ids), (select a_owner_role from ids)),
  '42501', 'ESCALATION_DENIED', 'a manager cannot invite an Owner');
select throws_ok(format($q$select public.change_member_role(%L, %L)$q$, (select a_manager from ids), (select a_owner_role from ids)),
  '42501', 'ESCALATION_DENIED', 'a manager cannot promote themselves to Owner');
select throws_ok(format($q$select public.change_member_role(%L, %L)$q$, (select a_cashier from ids), (select a_owner_role from ids)),
  '42501', 'ESCALATION_DENIED', 'a manager cannot promote someone else to Owner');
select throws_ok(format($q$select public.set_member_status(%L, 'deactivated')$q$, (select a_owner from ids)),
  '42501', 'ESCALATION_DENIED', 'a manager cannot deactivate an Owner');
select throws_ok(format($q$select public.change_member_role(%L, %L)$q$, (select a_owner from ids), (select a_manager_role from ids)),
  '42501', 'ESCALATION_DENIED', 'a manager cannot demote an Owner');
select throws_ok($q$select public.create_role((select a_org from ids), 'Super', null, array['staff.manage', 'settings.branding', 'settings.manage'])$q$,
  '42501', 'ESCALATION_DENIED', 'a manager cannot build a role with a permission they lack (settings.manage)');

select pg_temp.as_user(3); -- cashier: no staff.manage at all
select throws_ok(format($q$select public.create_staff_invitation(%L, 'esc2@example.test', %L, pg_temp.hash('esc2'), true, null)$q$, (select a_org from ids), (select a_owner_role from ids)),
  '42501', 'FORBIDDEN', 'a cashier cannot invite anyone');
select throws_ok(format($q$select public.change_member_role(%L, %L)$q$, (select a_cashier from ids), (select a_manager_role from ids)),
  '42501', 'FORBIDDEN', 'a cashier cannot promote themselves');
select throws_ok(format($q$select public.set_member_status(%L, 'deactivated')$q$, (select a_manager from ids)),
  '42501', 'FORBIDDEN', 'a cashier cannot deactivate a manager');
select throws_ok(format($q$select public.set_member_locations(%L, '{}')$q$, (select a_cashier from ids)),
  '42501', 'FORBIDDEN', 'a cashier cannot change their own locations');

select pg_temp.as_user(4); -- waiter
select throws_ok(format($q$select public.create_role(%L, 'Sneaky', null, array['pos.use'])$q$, (select a_org from ids)),
  '42501', 'FORBIDDEN', 'a waiter cannot create a role');

-- Across tenants: the owner of B reaches for A's people, roles and invitations.
select pg_temp.as_user(5);
select throws_ok(format($q$select public.change_member_role(%L, %L)$q$, (select a_cashier from ids), (select b_cashier_role from ids)),
  '42501', 'FORBIDDEN', 'the owner of B cannot change a member of A');
select throws_ok(format($q$select public.set_member_status(%L, 'deactivated')$q$, (select a_owner from ids)),
  '42501', 'FORBIDDEN', 'the owner of B cannot deactivate the owner of A');
select throws_ok(format($q$select public.create_staff_invitation(%L, 'x-tenant@example.test', %L, pg_temp.hash('xt'), true, null)$q$, (select a_org from ids), (select a_owner_role from ids)),
  '42501', 'FORBIDDEN', 'the owner of B cannot invite into A');
select throws_ok(format($q$select public.create_staff_invitation(%L, 'x-role@example.test', %L, pg_temp.hash('xr'), true, null)$q$, (select b_org from ids), (select a_manager_role from ids)),
  'P0001', 'ROLE_INVALID', 'the owner of B cannot invite into B with a role that belongs to A');
select throws_ok(format($q$select public.delete_role(%L)$q$, (select a_manager_role from ids)),
  '42501', 'FORBIDDEN', 'the owner of B cannot delete a role of A');
select is((select count(*)::int from public.get_org_package((select a_org from ids))), 0, 'the owner of B gets nothing for the plan of A');

-- ---------------------------------------------------------------------------------------------
-- 2. Last owner
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(1);
-- Through the RPCs nobody acts on their own membership, so the sole owner is refused before LAST_OWNER.
select throws_ok(format($q$select public.set_member_status(%L, 'deactivated')$q$, (select a_owner from ids)),
  '42501', 'ESCALATION_DENIED', 'the only owner cannot deactivate themselves');
select throws_ok(format($q$select public.change_member_role(%L, %L)$q$, (select a_owner from ids), (select a_manager_role from ids)),
  '42501', 'ESCALATION_DENIED', 'the only owner cannot demote themselves');
select throws_ok($q$delete from public.organization_members where user_id = pg_temp.uuid_of(1)$q$, '42501', null, 'the owner cannot delete a member row through the API');

-- The database rule itself (a trigger, for any writer that skips the RPCs, such as a future job or a console).
reset role;
select pg_temp.no_user();
select throws_ok(format($q$update public.organization_members set status = 'deactivated' where id = %L$q$, (select a_owner from ids)),
  'P0001', 'LAST_OWNER', 'LAST_OWNER: the trigger refuses to deactivate the only owner');
select throws_ok(format($q$update public.organization_members set role_id = %L where id = %L$q$, (select a_manager_role from ids), (select a_owner from ids)),
  'P0001', 'LAST_OWNER', 'LAST_OWNER: the trigger refuses to demote the only owner');
select throws_ok(format($q$delete from public.organization_members where id = %L$q$, (select a_owner from ids)),
  'P0001', 'MEMBER_DELETE', 'a member row cannot be deleted, even by postgres');
set local role authenticated;
select pg_temp.as_user(1);
select is((select count(*)::int from public.organization_members where org_id = (select a_org from ids) and status = 'active'
           and role_id = (select a_owner_role from ids)), 1, 'A still has exactly one active owner after the attacks');

-- ---------------------------------------------------------------------------------------------
-- 3. Limits: staff, organizations per owner, plan features
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(10); -- owner of the org with max_staff = 2 and two people already
select throws_ok(format($q$select public.create_staff_invitation(%L, 'third@example.test', %L, pg_temp.hash('third'), true, null)$q$, (select tiny_org from ids), (select tiny_cashier_role from ids)),
  'P0001', 'PLAN_LIMIT:staff', 'a third person is refused at a staff limit of 2');

select throws_ok(format($q$select public.create_role(%L, 'Extra', null, array['pos.use'])$q$, (select tiny_org from ids)),
  'P0001', 'PLAN_FEATURE:custom_roles', 'a custom role is refused on a plan without the feature');

select pg_temp.as_user(9); -- already owns three organizations
select throws_ok($q$select * from public.create_organization('Fourth', 'abuse-fourth', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$,
  'P0001', 'ORG_CAP', 'a fourth organization is refused at the cap of 3');

select pg_temp.as_user(1);
select throws_ok(format($q$insert into public.locations (org_id, name) values (%L, 'Sneaky')$q$, (select a_org from ids)),
  '42501', null, 'adding a location straight to the table is denied (plan limit cannot be bypassed)');

-- ---------------------------------------------------------------------------------------------
-- 4. Invitations: wrong email, reused, expired, revoked, unconfirmed, unknown
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(7); -- confirmed, but the invitation is for user 6
select throws_ok($q$select * from public.accept_invitation('tok-wrong-email')$q$, 'P0001', 'INVITATION_EMAIL_MISMATCH', 'a token sent to someone else is refused');
select throws_ok($q$select * from public.accept_invitation('tok-good')$q$, 'P0001', 'INVITATION_EMAIL_MISMATCH', 'a valid token on the wrong account is refused');
select is((select count(*)::int from public.organization_members where user_id = pg_temp.uuid_of(7)), 0, 'the wrong-email attempts created no membership');

select pg_temp.as_user(8); -- invitation matches, email never confirmed
select throws_ok($q$select * from public.accept_invitation('tok-unconfirmed')$q$, 'P0001', 'INVITATION_INVALID', 'an unconfirmed email cannot accept');

select pg_temp.as_user(7);
select throws_ok($q$select * from public.accept_invitation('tok-expired')$q$, 'P0001', 'INVITATION_INVALID', 'an expired token is refused');
select throws_ok($q$select * from public.accept_invitation('tok-revoked')$q$, 'P0001', 'INVITATION_INVALID', 'a revoked token is refused');
select throws_ok($q$select * from public.accept_invitation('not-a-token')$q$, 'P0001', 'INVITATION_INVALID', 'an unknown token is refused');
select throws_ok($q$select * from public.accept_invitation('')$q$, 'P0001', 'INVITATION_INVALID', 'an empty token is refused');
select throws_ok($q$select * from public.accept_invitation(null)$q$, 'P0001', 'INVITATION_INVALID', 'a null token is refused');
select throws_ok($q$select * from public.accept_invitation('TOK-GOOD')$q$, 'P0001', 'INVITATION_INVALID', 'a token is case sensitive');
select throws_ok($q$select * from public.accept_invitation('tok-good%')$q$, 'P0001', 'INVITATION_INVALID', 'a token with an added character is refused');

-- The right person accepts once; every replay fails, from any account.
select pg_temp.as_user(6);
select lives_ok($q$select * from public.accept_invitation('tok-good')$q$, 'the invited, confirmed person accepts once');
select throws_ok($q$select * from public.accept_invitation('tok-good')$q$, 'P0001', 'INVITATION_INVALID', 'replaying the same token as the same person is refused');
select pg_temp.as_user(7);
select throws_ok($q$select * from public.accept_invitation('tok-good')$q$, 'P0001', 'INVITATION_INVALID', 'replaying it from another account is refused');
select pg_temp.as_user(6);
select is((select count(*)::int from public.organization_members where user_id = pg_temp.uuid_of(6) and org_id = (select a_org from ids)), 1, 'the accepted invitation produced exactly one membership');

-- Joining with a second token while already a member.
reset role;
select pg_temp.no_user();
select pg_temp.invite('abuse-a', 'abuse6@example.test', 'kitchen', 'tok-owner-bound'); -- the earlier one is closed now
set local role authenticated;
select pg_temp.as_user(6);
select throws_ok($q$select * from public.accept_invitation('tok-owner-bound')$q$, 'P0001', 'ALREADY_MEMBER', 'an existing member cannot take a second seat with another token');

-- The preview must not become an oracle: one answer for every dead token, and never the email or an id.
select pg_temp.as_user(7);
select is((select status from public.get_invitation_preview('tok-wrong-email')), 'open', 'preview: a live token is open');
select is((select status || coalesce(org_name, '') || coalesce(org_slug, '') || coalesce(role_name, '') from public.get_invitation_preview('not-a-token')),
  'unavailable', 'preview: an unknown token is unavailable with no names');
select is((select status || coalesce(org_name, '') || coalesce(org_slug, '') || coalesce(role_name, '') from public.get_invitation_preview('tok-revoked')),
  'unavailable', 'preview: a revoked token looks exactly like an unknown one');
select is((select status || coalesce(org_name, '') || coalesce(org_slug, '') || coalesce(role_name, '') from public.get_invitation_preview(null)),
  'unavailable', 'preview: no token is unavailable');
select is((select status from public.get_invitation_preview('tok-expired')), 'expired', 'preview: an expired token says expired (by design, names shown so the person can ask for a new one)');
select is((select array_agg(k order by k) from jsonb_object_keys((select to_jsonb(p) from public.get_invitation_preview('tok-good') p)) k),
  array['org_name', 'org_slug', 'role_name', 'status'], 'preview: only name, slug, role and status, never the invited email or an id');

-- ---------------------------------------------------------------------------------------------
-- 5. Slug rules (create_organization), as a signed-in user with room for one more organization
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(2);
select throws_ok($q$select * from public.create_organization('S', 'ab', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_INVALID', 'a 2-character slug is refused');
select throws_ok($q$select * from public.create_organization('S', 'Has Space', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_INVALID', 'a slug with a space is refused');
select throws_ok($q$select * from public.create_organization('S', 'a--b', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_INVALID', 'a double hyphen is refused');
select throws_ok($q$select * from public.create_organization('S', 'under_score', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_INVALID', 'an underscore is refused');
select throws_ok($q$select * from public.create_organization('S', 'www', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_RESERVED', 'a reserved slug (www) is refused');
select throws_ok($q$select * from public.create_organization('S', 'abuse-a', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_TAKEN', 'a taken slug is refused');
select throws_ok($q$select * from public.create_organization('S', 'ABUSE-A', 'Asia/Jakarta', 'Main', null, 0, 0, false)$q$, 'P0001', 'SLUG_TAKEN', 'a taken slug in other case is refused');
select is((select count(*)::int from public.organizations where slug in ('ab', 'www', 'a--b', 'under_score')), 0, 'no refused slug left an organization behind');

select * from finish();
rollback;
