-- M0-BE-12: RPCs (slug check, create organization, accept invitation, member locations, storefront)
-- and the S4 hardening. RPCs are definer functions, so most cases run as postgres with auth.uid()
-- set by the claims; grant cases switch roles.
begin;
select plan(146);

-- Confirmed, as real sign-ups are: accept_invitation refuses callers whose email is unconfirmed.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@example.test', now()
from generate_series(1, 14) n;

create function pg_temp.uid(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0')), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.nouid() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create function pg_temp.uuid_of(p_user int) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0'))::uuid;
$$;
-- Row counts that a half-created organization would change.
create function pg_temp.snap() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.organizations), (select count(*) from public.roles),
    (select count(*) from public.role_permissions), (select count(*) from public.subscriptions),
    (select count(*) from public.organization_members), (select count(*) from public.locations),
    (select count(*) from public.location_staff), (select count(*) from public.audit_logs),
    (select count(*) from public.staff_invitations where accepted_at is not null));
$$;
create function pg_temp.hash(p text) returns bytea language sql as $$ select sha256(convert_to(p, 'UTF8')); $$;

-- Default package: room for the fixture; individual cases lower it and restore it.
update public.packages set max_locations = 5, max_staff = 20, max_tables = 20 where is_default;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.is_slug_available(text)', 'execute'), 'anon cannot check slugs');
select ok(not has_function_privilege('anon', 'public.create_organization(text,text,text,text,text,integer,integer,boolean)', 'execute'), 'anon cannot create organizations');
select ok(not has_function_privilege('anon', 'public.accept_invitation(text)', 'execute'), 'anon cannot accept invitations');
select ok(not has_function_privilege('anon', 'public.set_member_locations(uuid,uuid[])', 'execute'), 'anon cannot set member locations');
select ok(has_function_privilege('anon', 'public.get_storefront(text)', 'execute'), 'anon can read a storefront');
select ok(has_function_privilege('authenticated', 'public.create_organization(text,text,text,text,text,integer,integer,boolean)', 'execute'), 'authenticated can create organizations');
select ok(not has_function_privilege('authenticated', 'private.is_accepting_invitation(uuid,uuid,uuid)', 'execute'), 'the acceptance check is not callable');
select ok(not has_function_privilege('service_role', 'public.create_organization(text,text,text,text,text,integer,integer,boolean)', 'execute'), 'service_role does not need the RPCs');

-- ---------------------------------------------------------------------------------------------
-- is_slug_available
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
select is((select available from public.is_slug_available('fresh-name')), true, 'a free slug is available');
select is((select reason from public.is_slug_available('fresh-name')), null, 'with no reason');
select is((select available from public.is_slug_available('  Fresh-Name ')), true, 'input is normalized');
select is((select reason from public.is_slug_available('www')), 'SLUG_RESERVED', 'reserved');
select is((select reason from public.is_slug_available('ab')), 'SLUG_INVALID', 'too short');
select is((select reason from public.is_slug_available(repeat('a', 41))), 'SLUG_INVALID', 'too long');
select is((select reason from public.is_slug_available('a--b')), 'SLUG_INVALID', 'double hyphen');
select is((select reason from public.is_slug_available('-abc')), 'SLUG_INVALID', 'edge hyphen');
select is((select reason from public.is_slug_available('has space')), 'SLUG_INVALID', 'space');
select is((select reason from public.is_slug_available(null)), 'SLUG_INVALID', 'null');
select pg_temp.nouid();
select throws_ok($$select * from public.is_slug_available('fresh-name')$$, '28000', 'UNAUTHENTICATED', 'needs a signed-in user');

-- ---------------------------------------------------------------------------------------------
-- create_organization
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
select is((select new_org_slug from public.create_organization('Warung A', 'warung-a', 'Asia/Makassar', 'Main', 'Jl. Satu', 1000, 500, true)), 'warung-a', 'creates an organization');
select is((select reason from public.is_slug_available('warung-a')), 'SLUG_TAKEN', 'and the slug is now taken');
select is((select count(*)::int from public.roles r join public.organizations o on o.id = r.org_id where o.slug = 'warung-a' and r.is_system), 5, 'five system roles seeded');
select is((select s.status from public.subscriptions s join public.organizations o on o.id = s.org_id where o.slug = 'warung-a'), 'trialing', 'a trial subscription started');
select ok((select s.trial_ends_at > now() + interval '13 days' from public.subscriptions s join public.organizations o on o.id = s.org_id where o.slug = 'warung-a'), 'with trial_ends_at set');
select is((select r.system_key from public.organization_members m join public.roles r on r.id = m.role_id join public.organizations o on o.id = m.org_id where o.slug = 'warung-a' and m.user_id = pg_temp.uuid_of(1)), 'owner', 'the caller is the Owner');
select is((select l.name || '/' || l.tax_bps || '/' || l.service_charge_bps || '/' || l.tax_on_service || '/' || l.timezone from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'warung-a'), 'Main/1000/500/true/Asia/Makassar', 'the first location carries the tax and service defaults');
select ok((select count(*) from public.audit_logs a join public.organizations o on o.id = a.org_id where o.slug = 'warung-a' and a.action = 'organization.created' and a.actor_id = pg_temp.uuid_of(1)) = 1, 'creation is audited with the caller as actor');
select is((select l.name from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'warung-a'), 'Main', 'location name given');
select lives_ok($$select * from public.create_organization('  Kedai B ', ' Kedai-B ')$$, 'name and slug are trimmed, optional fields default');
select is((select l.name || '/' || l.timezone from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'kedai-b'), 'Kedai B/Asia/Jakarta', 'location defaults to the org name and Asia/Jakarta');

-- Nothing is left behind by a failure at any step
create temp table before_snap (s text);
insert into before_snap select pg_temp.snap();
select throws_ok($$select * from public.create_organization('X', 'warung-a')$$, 'P0001', 'SLUG_TAKEN', 'taken slug');
select throws_ok($$select * from public.create_organization('X', 'admin')$$, 'P0001', 'SLUG_RESERVED', 'reserved slug');
select throws_ok($$select * from public.create_organization('X', 'a--b')$$, 'P0001', 'SLUG_INVALID', 'invalid slug');
select throws_ok($$select * from public.create_organization('   ', 'valid-slug')$$, 'P0001', 'NAME_INVALID', 'blank name');
select throws_ok($$select * from public.create_organization('X', 'tz-fail', 'Mars/Base')$$, '22023', null, 'step: organization insert (bad timezone)');
select is(pg_temp.snap(), (select s from before_snap), 'nothing left after the early failures');
update public.packages set is_default = false where is_default;
select throws_ok($$select * from public.create_organization('X', 'no-trial')$$, 'P0002', 'no default package', 'step: trial start (no default package)');
select is(pg_temp.snap(), (select s from before_snap), 'nothing left after a trial failure');
update public.packages set is_default = true where key = 'trial';
update public.packages set max_staff = 0 where is_default;
select throws_ok($$select * from public.create_organization('X', 'no-owner')$$, 'P0001', 'PLAN_LIMIT:staff', 'step: owner member (staff limit)');
select is(pg_temp.snap(), (select s from before_snap), 'nothing left after an owner member failure');
update public.packages set max_staff = 20, max_locations = 0 where is_default;
select throws_ok($$select * from public.create_organization('X', 'no-loc')$$, 'P0001', 'PLAN_LIMIT:locations', 'step: first location (location limit)');
select is(pg_temp.snap(), (select s from before_snap), 'nothing left after a location failure');
update public.packages set max_locations = 5 where is_default;
select throws_ok($$select * from public.create_organization('X', 'bad-tax', null, null, null, 10001)$$, '23514', null, 'step: first location (rate out of range)');
select is(pg_temp.snap(), (select s from before_snap), 'nothing left after a constraint failure');
select throws_ok($$select * from public.create_organization(repeat('n', 121), 'long-name')$$, 'P0001', 'NAME_INVALID', 'name too long');

-- Per-user cap of three owned organizations
select pg_temp.uid(2);
select lives_ok($$select * from public.create_organization('C1', 'cap-one')$$, 'cap: first');
select lives_ok($$select * from public.create_organization('C2', 'cap-two')$$, 'cap: second');
select lives_ok($$select * from public.create_organization('C3', 'cap-three')$$, 'cap: third');
select throws_ok($$select * from public.create_organization('C4', 'cap-four')$$, 'P0001', 'ORG_CAP', 'cap: the fourth is refused');
select is((select count(*)::int from public.organizations where slug = 'cap-four'), 0, 'and leaves nothing');
select pg_temp.uid(3);
select lives_ok($$select * from public.create_organization('Other user', 'cap-other')$$, 'the cap is per user');
select pg_temp.nouid();
select throws_ok($$select * from public.create_organization('X', 'no-user')$$, '28000', 'UNAUTHENTICATED', 'needs a signed-in user');

-- ---------------------------------------------------------------------------------------------
-- accept_invitation. Org 'warung-a' (owner u1) gets two locations.
-- ---------------------------------------------------------------------------------------------
insert into public.locations (org_id, name) select id, 'Second' from public.organizations where slug = 'warung-a';
create temp table ctx on commit drop as
select o.id as org,
       (select id from public.locations where org_id = o.id and name = 'Main') as loc1,
       (select id from public.locations where org_id = o.id and name = 'Second') as loc2,
       (select id from public.roles where org_id = o.id and system_key = 'cashier') as cashier,
       (select id from public.roles where org_id = o.id and system_key = 'waiter') as waiter,
       (select id from public.roles where org_id = o.id and system_key = 'manager') as manager
from public.organizations o where o.slug = 'warung-a';

create function pg_temp.invite(p_email text, p_token text, p_role text, p_all boolean default false) returns uuid language sql as $$
  insert into public.staff_invitations (org_id, email, role_id, token_hash, all_locations, expires_at)
  select org, p_email, case p_role when 'cashier' then cashier when 'waiter' then waiter else manager end, pg_temp.hash(p_token), p_all, now() + interval '3 days' from ctx
  returning id;
$$;

select pg_temp.invite('u4@example.test', 'tok-ok', 'cashier');
insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
select i.id, c.loc1, c.org from public.staff_invitations i, ctx c where i.email = 'u4@example.test';

select pg_temp.uid(4);
select is((select joined_org_slug from public.accept_invitation('tok-ok')), 'warung-a', 'a valid token joins the organization');
select is((select r.system_key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = pg_temp.uuid_of(4) and m.org_id = (select org from ctx)), 'cashier', 'with the invited role');
select is((select count(*)::int from public.location_staff s join public.organization_members m on m.id = s.member_id where m.user_id = pg_temp.uuid_of(4)), 1, 'and the invited locations');
select ok((select accepted_at is not null and accepted_by = pg_temp.uuid_of(4) from public.staff_invitations where email = 'u4@example.test'), 'the invitation is closed by the caller');
select ok((select count(*) from public.audit_logs where action = 'staff_invitation.accepted' and org_id = (select org from ctx)) = 1, 'acceptance is audited');
select throws_ok($$select * from public.accept_invitation('tok-ok')$$, 'P0001', 'INVITATION_INVALID', 'a used token is refused');
select throws_ok($$select * from public.accept_invitation('nope')$$, 'P0001', 'INVITATION_INVALID', 'an unknown token is refused');
select throws_ok($$select * from public.accept_invitation(null)$$, 'P0001', 'INVITATION_INVALID', 'a null token is refused');
select throws_ok($$select * from public.accept_invitation('')$$, 'P0001', 'INVITATION_INVALID', 'an empty token is refused');

-- wrong email
select pg_temp.nouid();
select pg_temp.invite('u5@example.test', 'tok-mismatch', 'waiter');
select pg_temp.uid(6);
select throws_ok($$select * from public.accept_invitation('tok-mismatch')$$, 'P0001', 'INVITATION_EMAIL_MISMATCH', 'a token for another email is refused');
select is((select accepted_at from public.staff_invitations where email = 'u5@example.test'), null, 'and stays open');
select is((select count(*)::int from public.organization_members where user_id = pg_temp.uuid_of(6)), 0, 'with no member created');

-- revoked, expired
select pg_temp.nouid();
select pg_temp.invite('u6@example.test', 'tok-revoked', 'waiter');
update public.staff_invitations set revoked_at = now() where email = 'u6@example.test';
insert into public.staff_invitations (org_id, email, role_id, token_hash, created_at, expires_at)
select org, 'u6@example.test', waiter, pg_temp.hash('tok-expired'), now() - interval '3 days', now() - interval '1 day' from ctx;
select pg_temp.uid(6);
select throws_ok($$select * from public.accept_invitation('tok-revoked')$$, 'P0001', 'INVITATION_INVALID', 'a revoked token is refused');
select throws_ok($$select * from public.accept_invitation('tok-expired')$$, 'P0001', 'INVITATION_INVALID', 'an expired token is refused');

-- unconfirmed email
select pg_temp.nouid();
update auth.users set email_confirmed_at = null where id = pg_temp.uuid_of(7);
select pg_temp.invite('u7@example.test', 'tok-unconfirmed', 'waiter');
select pg_temp.uid(7);
select throws_ok($$select * from public.accept_invitation('tok-unconfirmed')$$, 'P0001', 'INVITATION_INVALID', 'an unconfirmed email cannot accept');
select is((select count(*)::int from public.organization_members where user_id = pg_temp.uuid_of(7)), 0, 'and nothing is created');

-- suspended org
select pg_temp.nouid();
select pg_temp.invite('u8@example.test', 'tok-suspended', 'waiter');
update public.organizations set status = 'suspended' where slug = 'warung-a';
select pg_temp.uid(8);
select throws_ok($$select * from public.accept_invitation('tok-suspended')$$, 'P0001', 'INVITATION_INVALID', 'a suspended organization cannot be joined');
select pg_temp.nouid();
update public.organizations set status = 'active' where slug = 'warung-a';

-- the email match ignores case and padding
update auth.users set email = ' U8@Example.Test ' where id = pg_temp.uuid_of(8);
select pg_temp.uid(8);
select lives_ok($$select * from public.accept_invitation('tok-suspended')$$, 'the email match is normalized');

-- all_locations copies every location
select pg_temp.nouid();
select pg_temp.invite('u9@example.test', 'tok-all', 'waiter', true);
select pg_temp.uid(9);
select lives_ok($$select * from public.accept_invitation('tok-all')$$, 'all-locations invitation accepted');
select is((select count(*)::int from public.location_staff s join public.organization_members m on m.id = s.member_id where m.user_id = pg_temp.uuid_of(9)), 2, 'gets a row for every location');

-- already an active member
select pg_temp.nouid();
select pg_temp.invite('u9@example.test', 'tok-again', 'manager');
select pg_temp.uid(9);
select throws_ok($$select * from public.accept_invitation('tok-again')$$, 'P0001', 'ALREADY_MEMBER', 'an active member cannot accept another invitation');
select is((select accepted_at from public.staff_invitations where token_hash = pg_temp.hash('tok-again')), null, 'which stays open');
select is((select r.system_key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = pg_temp.uuid_of(9)), 'waiter', 'and the role is unchanged');

-- a deactivated member rejoins through a new invitation, and cannot reactivate themself otherwise
select pg_temp.nouid();
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = pg_temp.uuid_of(4);
select pg_temp.uid(4);
select throws_ok($$update public.organization_members set status = 'active', deactivated_at = null where user_id = pg_temp.uuid_of(4)$$, '42501', 'ESCALATION_DENIED', 'S4: a deactivated member cannot reactivate themself');
select pg_temp.nouid();
select pg_temp.invite('u4@example.test', 'tok-rejoin', 'waiter');
insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
select i.id, c.loc2, c.org from public.staff_invitations i, ctx c where i.token_hash = pg_temp.hash('tok-rejoin');
select pg_temp.uid(4);
select lives_ok($$select * from public.accept_invitation('tok-rejoin')$$, 'a new invitation reactivates a deactivated member');
select is((select r.system_key || '/' || m.status from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = pg_temp.uuid_of(4)), 'waiter/active', 'with the new role');
select is((select count(*)::int from public.organization_members where user_id = pg_temp.uuid_of(4)), 1, 'on the same member row');
select is((select l.name from public.location_staff s join public.organization_members m on m.id = s.member_id join public.locations l on l.id = s.location_id where m.user_id = pg_temp.uuid_of(4)), 'Second', 'and the locations are replaced');

-- failures leave nothing: plan limit at the member step, a failure at the location step
select pg_temp.nouid();
select pg_temp.invite('u10@example.test', 'tok-limit', 'cashier', true);
update public.packages set max_staff = (select count(*) from public.organization_members where org_id = (select org from ctx) and status = 'active') where is_default;
delete from before_snap; insert into before_snap select pg_temp.snap();
select pg_temp.uid(10);
select throws_ok($$select * from public.accept_invitation('tok-limit')$$, 'P0001', 'PLAN_LIMIT:staff', 'step: member insert (staff limit)');
select is(pg_temp.snap(), (select s from before_snap), 'nothing left, the invitation stays open');
select pg_temp.nouid();
update public.packages set max_staff = 20 where is_default;
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end; $$;
create trigger zz_boom before insert on public.location_staff for each row execute function pg_temp.boom();
select pg_temp.uid(10);
select throws_ok($$select * from public.accept_invitation('tok-limit')$$, 'P0001', 'boom', 'step: location copy (forced failure)');
select pg_temp.nouid();
select is(pg_temp.snap(), (select s from before_snap), 'nothing left: no member, no closed invitation, no audit row');
drop trigger zz_boom on public.location_staff;
select pg_temp.uid(10);
select lives_ok($$select * from public.accept_invitation('tok-limit')$$, 'and the same token works once the cause is gone');
select pg_temp.nouid();
select throws_ok($$select * from public.accept_invitation('tok-ok')$$, '28000', 'UNAUTHENTICATED', 'needs a signed-in user');

-- ---------------------------------------------------------------------------------------------
-- set_member_locations. u1 owner, u4 waiter, u9 waiter, u10 cashier of warung-a.
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx), (select loc2 from ctx)])$$, 'owner sets two locations');
select is((select count(*)::int from public.location_staff where member_id = (select id from public.organization_members where user_id = pg_temp.uuid_of(10))), 2, 'both are stored');
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc2 from ctx), (select loc2 from ctx)])$$, 'replace with one (duplicates ignored)');
select is((select array_agg(location_id) from public.location_staff where member_id = (select id from public.organization_members where user_id = pg_temp.uuid_of(10))), array[(select loc2 from ctx)], 'only the new list remains');
-- another tenant's location: refused, and the old list stays (atomic)
select pg_temp.uid(11);
select lives_ok($$select * from public.create_organization('Other tenant', 'other-tenant')$$, 'a second tenant');
select pg_temp.uid(1);
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx), (select l.id from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'other-tenant')])$$, 'P0001', 'LOCATION_INVALID', 'a location from another org is refused');
select is((select array_agg(location_id) from public.location_staff where member_id = (select id from public.organization_members where user_id = pg_temp.uuid_of(10))), array[(select loc2 from ctx)], 'and nothing changed');
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[gen_random_uuid()])$$, 'P0001', 'LOCATION_INVALID', 'an unknown location is refused');
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), null)$$, 'P0001', 'LOCATION_INVALID', 'null list refused');
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[]::uuid[])$$, 'an empty list clears');
select is((select count(*)::int from public.location_staff where member_id = (select id from public.organization_members where user_id = pg_temp.uuid_of(10))), 0, 'no rows');
-- permission and tenant
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(11)), array[]::uuid[])$$, '42501', 'FORBIDDEN', 'a member of another org is forbidden');
select throws_ok($$select public.set_member_locations(gen_random_uuid(), array[]::uuid[])$$, '42501', 'FORBIDDEN', 'an unknown member is forbidden');
select pg_temp.uid(4);
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx)])$$, '42501', 'FORBIDDEN', 'a waiter (no staff.manage) is forbidden');
select pg_temp.uid(12);
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx)])$$, '42501', 'FORBIDDEN', 'a non-member is forbidden');
select pg_temp.nouid();
select throws_ok($$select public.set_member_locations(gen_random_uuid(), array[]::uuid[])$$, '28000', 'UNAUTHENTICATED', 'needs a signed-in user');
-- a manager has staff.manage
select pg_temp.uid(1);
select pg_temp.nouid();
select pg_temp.invite('u12@example.test', 'tok-manager', 'manager');
select pg_temp.uid(12);
select lives_ok($$select * from public.accept_invitation('tok-manager')$$, 'a manager joins');
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx)])$$, 'and may set locations (staff.manage)');
select pg_temp.nouid();

-- A custom role with staff.manage plus the cashier permissions, limited to location LA1 (Main)
insert into public.roles (org_id, name) select org, 'Loc admin' from ctx;
insert into public.role_permissions (role_id, org_id, permission_key)
select r.id, r.org_id, k
from public.roles r, (select permission_key as k from public.role_permissions rp join public.roles c on c.id = rp.role_id where c.system_key = 'cashier' and c.org_id = (select org from ctx)
                      union select 'staff.manage') perms
where r.name = 'Loc admin' and r.org_id = (select org from ctx);
insert into public.organization_members (org_id, user_id, role_id)
select org, pg_temp.uuid_of(13), (select id from public.roles where name = 'Loc admin' and org_id = ctx.org) from ctx;
insert into public.location_staff (member_id, location_id, org_id)
select m.id, c.loc1, c.org from public.organization_members m, ctx c where m.user_id = pg_temp.uuid_of(13);
select pg_temp.uid(1);
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx), (select loc2 from ctx)])$$, 'setup: the cashier has both locations');
select pg_temp.uid(13);
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(13)), array[(select loc1 from ctx), (select loc2 from ctx)])$$, '42501', 'FORBIDDEN', 'a limited staff.manage member cannot widen their own locations');
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc2 from ctx)])$$, 'P0001', 'LOCATION_INVALID', 'nor give another member a location they cannot reach');
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx)])$$, 'but can give a location they reach');
select is((select array_agg(l.name order by l.name) from public.location_staff s join public.locations l on l.id = s.location_id where s.member_id = (select id from public.organization_members where user_id = pg_temp.uuid_of(10))), array['Main','Second'], 'and the locations outside their reach are left alone');
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(1) and org_id = (select org from ctx)), array[(select loc1 from ctx)])$$, '42501', 'FORBIDDEN', 'nobody but an Owner edits an Owner''s locations');
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(12)), array[(select loc1 from ctx)])$$, '42501', 'FORBIDDEN', 'nor a manager (their role holds permissions the caller lacks)');
select pg_temp.uid(12);
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(10)), array[(select loc1 from ctx), (select loc2 from ctx)])$$, 'a Manager can give a Cashier both locations');
select is((select count(*)::int from public.location_staff where member_id = (select id from public.organization_members where user_id = pg_temp.uuid_of(10))), 2, 'both are stored');
select throws_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(1) and org_id = (select org from ctx)), array[(select loc1 from ctx)])$$, '42501', 'FORBIDDEN', 'a Manager cannot edit an Owner''s locations');
select pg_temp.uid(1);
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(1) and org_id = (select org from ctx)), array[(select loc1 from ctx)])$$, 'an Owner can edit their own locations');
select lives_ok($$select public.set_member_locations((select id from public.organization_members where user_id = pg_temp.uuid_of(13)), array[(select loc1 from ctx), (select loc2 from ctx)])$$, 'and widen a limited member');
select pg_temp.nouid();

-- ---------------------------------------------------------------------------------------------
-- get_storefront (as anon)
-- ---------------------------------------------------------------------------------------------
insert into public.org_branding (org_id, logo_url) select org, 'https://cdn.example.test/logo.png' from ctx;
select pg_temp.nouid();
set local role anon;
select is((select public.get_storefront('warung-a') ->> 'name'), 'Warung A', 'anon reads the storefront name');
select is((select public.get_storefront('  WARUNG-A ') ->> 'slug'), 'warung-a', 'the slug is normalized');
select is((select public.get_storefront('warung-a') ->> 'logo_url'), 'https://cdn.example.test/logo.png', 'with the logo');
select is((select jsonb_array_length(public.get_storefront('warung-a') -> 'locations')), 2, 'and its locations');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_storefront('warung-a')) k), array['locations','logo_url','name','slug','suspended'], 'only the public keys at the top level');
select is((select array_agg(k order by k) from jsonb_object_keys((public.get_storefront('warung-a') -> 'locations') -> 0) k), array['address','currency','id','name','service_charge_bps','tax_bps','tax_on_service','timezone'], 'and only the public location fields');
select ok(not (public.get_storefront('warung-a')::text ~* '(email|user_id|member|role|subscription|package|org_id|token)'), 'no member, role, subscription or org data');
select is(public.get_storefront('no-such-org'), null, 'an unknown slug gives null');
select is(public.get_storefront(null), null, 'null gives null');
select throws_ok($$select * from public.is_slug_available('x1y')$$, '42501', null, 'anon cannot call the authenticated RPCs');
reset role;
update public.organizations set status = 'suspended' where slug = 'warung-a';
set local role anon;
select is(public.get_storefront('warung-a'), '{"slug": "warung-a", "suspended": true}'::jsonb, 'a suspended org returns only the flag');
reset role;
update public.organizations set status = 'active' where slug = 'warung-a';

-- ---------------------------------------------------------------------------------------------
-- S4 hardening
-- ---------------------------------------------------------------------------------------------
select throws_ok($$select private.org_limit((select org from ctx), null)$$, '22023', 'unknown limit key', 'S4: org_limit with a null key raises');
select throws_ok($$insert into public.roles (org_id, name) select org, ' Padded' from ctx$$, '23514', null, 'S4: role names are stored trimmed');
insert into public.roles (org_id, name) select org, 'Host' from ctx;
select throws_ok($$insert into public.roles (org_id, name) select org, 'HOST' from ctx$$, '23505', null, 'S4: role names are unique ignoring case');
select ok(not has_column_privilege('service_role', 'public.roles', 'org_id', 'update'), 'S4: service_role cannot move a role to another org');
select ok(not has_column_privilege('service_role', 'public.roles', 'is_system', 'update'), 'S4: nor flip is_system');
select ok(has_column_privilege('service_role', 'public.roles', 'name', 'update'), 'S4: it can rename');
select ok(not has_column_privilege('service_role', 'public.locations', 'org_id', 'update'), 'S4: locations.org_id is not updatable');
select ok(not has_column_privilege('service_role', 'public.organization_members', 'org_id', 'update'), 'S4: members.org_id is not updatable');
select ok(not has_column_privilege('service_role', 'public.organization_members', 'user_id', 'update'), 'S4: members.user_id is not updatable');
select ok(not has_column_privilege('service_role', 'public.staff_invitations', 'org_id', 'update'), 'S4: invitations.org_id is not updatable');
select ok(not has_column_privilege('service_role', 'public.staff_invitations', 'token_hash', 'update'), 'S4: invitations.token_hash is not updatable');
select ok(not has_column_privilege('service_role', 'public.subscriptions', 'org_id', 'update'), 'S4: subscriptions.org_id is not updatable');
select ok(not has_column_privilege('service_role', 'public.org_branding', 'org_id', 'update'), 'S4: org_branding.org_id is not updatable');
select ok(has_column_privilege('service_role', 'public.organizations', 'status', 'update'), 'the server can still suspend an org');
select pg_temp.invite('u13@example.test', 'tok-locs', 'cashier');
insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
select i.id, c.loc1, c.org from public.staff_invitations i, ctx c where i.token_hash = pg_temp.hash('tok-locs');
select throws_ok($$update public.staff_invitations set token_hash = pg_temp.hash('other') where token_hash = pg_temp.hash('tok-locs')$$, '55000', null, 'S4: a token hash never changes');
select lives_ok($$update public.staff_invitations set revoked_at = now() where token_hash = pg_temp.hash('tok-locs')$$, 'revoke an invitation that has a location list');
select throws_ok($$delete from public.staff_invitation_locations where invitation_id = (select id from public.staff_invitations where token_hash = pg_temp.hash('tok-locs'))$$, '55000', null, 'S4: the location list of a closed invitation cannot be deleted');
select pg_temp.invite('u13@example.test', 'tok-locs2', 'cashier');
insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
select i.id, c.loc1, c.org from public.staff_invitations i, ctx c where i.token_hash = pg_temp.hash('tok-locs2');
select lives_ok($$delete from public.staff_invitation_locations where invitation_id = (select id from public.staff_invitations where token_hash = pg_temp.hash('tok-locs2'))$$, 'an open invitation''s list can still be edited');
select lives_ok($$delete from public.organizations where slug in ('warung-a', 'kedai-b', 'other-tenant')$$, 'deleting organizations still cascades through everything');

select * from finish();
rollback;
