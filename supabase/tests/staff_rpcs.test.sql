-- M0-BE-30: staff RPCs. Definer functions, so cases run as postgres with auth.uid() set by the
-- claims; the grant cases read the privileges.
begin;
select plan(170);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@example.test', now()
from generate_series(1, 12) n;

create function pg_temp.uuid_of(p_user int) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0'))::uuid;
$$;
create function pg_temp.uid(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uuid_of(p_user), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.nouid() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create function pg_temp.h(p text) returns bytea language sql as $$ select sha256(convert_to(p, 'UTF8')); $$;
create function pg_temp.org(p_slug text) returns uuid language sql as $$ select id from public.organizations where slug = p_slug; $$;
create function pg_temp.role(p_slug text, p_key text) returns uuid language sql as $$
  select r.id from public.roles r where r.org_id = pg_temp.org(p_slug) and (r.system_key = p_key or (r.system_key is null and r.name = p_key));
$$;
create function pg_temp.loc(p_slug text, p_name text) returns uuid language sql as $$
  select l.id from public.locations l where l.org_id = pg_temp.org(p_slug) and l.name = p_name;
$$;
create function pg_temp.member(p_slug text, p_user int) returns uuid language sql as $$
  select m.id from public.organization_members m where m.org_id = pg_temp.org(p_slug) and m.user_id = pg_temp.uuid_of(p_user);
$$;
create function pg_temp.add_member(p_slug text, p_user int, p_key text) returns uuid language sql as $$
  insert into public.organization_members (org_id, user_id, role_id)
  values (pg_temp.org(p_slug), pg_temp.uuid_of(p_user), pg_temp.role(p_slug, p_key))
  returning id;
$$;
create function pg_temp.inv(p_email text) returns uuid language sql as $$
  select id from public.staff_invitations
  where org_id = pg_temp.org('staff-a') and email = p_email and accepted_at is null and revoked_at is null;
$$;
-- Row counts a half-done staff write would change.
create function pg_temp.snap() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.staff_invitations),
    (select count(*) from public.staff_invitations where revoked_at is not null),
    (select count(*) from public.staff_invitation_locations),
    (select count(*) from public.organization_members where status = 'active'),
    (select string_agg(role_id::text, ',' order by id) from public.organization_members),
    (select count(*) from public.audit_logs));
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixture. Org A: owner u1, manager u2, cashier u3, waiter u4, kitchen u5, and a custom
-- 'Supervisor' u6 (staff.manage + the Kitchen permissions) who reaches only location One.
-- Org B: owner u9. Created as postgres with no auth.uid(), so the escalation guards don't apply.
-- ---------------------------------------------------------------------------------------------
insert into public.packages (key, name, max_locations, max_staff) values ('staff_test', 'Staff RPC test', 5, 20);
insert into public.organizations (name, slug) values ('Staff A', 'staff-a'), ('Staff B', 'staff-b');
insert into public.subscriptions (org_id, package_id, status)
select o.id, p.id, 'active' from public.organizations o, public.packages p
where o.slug in ('staff-a', 'staff-b') and p.key = 'staff_test';
insert into public.locations (org_id, name) values
  (pg_temp.org('staff-a'), 'One'), (pg_temp.org('staff-a'), 'Two'), (pg_temp.org('staff-b'), 'Bee');

insert into public.roles (org_id, name) values (pg_temp.org('staff-a'), 'Supervisor');
insert into public.role_permissions (role_id, org_id, permission_key)
select pg_temp.role('staff-a', 'Supervisor'), pg_temp.org('staff-a'), k
from unnest(array['staff.manage', 'kitchen.view', 'kitchen.update', 'orders.view']) k;

select pg_temp.add_member('staff-a', 1, 'owner');
select pg_temp.add_member('staff-a', 2, 'manager');
select pg_temp.add_member('staff-a', 3, 'cashier');
select pg_temp.add_member('staff-a', 4, 'waiter');
select pg_temp.add_member('staff-a', 5, 'kitchen');
select pg_temp.add_member('staff-a', 6, 'Supervisor');
insert into public.location_staff (member_id, location_id, org_id)
values (pg_temp.member('staff-a', 6), pg_temp.loc('staff-a', 'One'), pg_temp.org('staff-a'));
select pg_temp.add_member('staff-b', 9, 'owner');
update public.packages set feature_custom_roles = true where key = 'staff_test';

-- Sessions: two for u4, one each for u1 and u5, each with a refresh token
insert into auth.sessions (id, user_id) select gen_random_uuid(), pg_temp.uuid_of(n) from unnest(array[1, 4, 4, 5]) n;
insert into auth.refresh_tokens (instance_id, token, user_id, session_id, revoked)
select '00000000-0000-0000-0000-000000000000', 'rt-' || s.id, s.user_id::text, s.id, false from auth.sessions s;

-- ---------------------------------------------------------------------------------------------
-- Grants: authenticated only; the helpers are not callable.
-- ---------------------------------------------------------------------------------------------
create temp table fns (sig text);
insert into fns values
  ('public.create_staff_invitation(uuid, text, uuid, bytea, boolean, uuid[])'), ('public.revoke_staff_invitation(uuid)'),
  ('public.resend_staff_invitation(uuid,bytea)'), ('public.change_member_role(uuid,uuid)'),
  ('public.set_member_status(uuid,text)'), ('public.create_role(uuid,text,text,text[])'),
  ('public.update_role(uuid,text,text,text[])'), ('public.delete_role(uuid)');
select ok(bool_and(has_function_privilege('authenticated', sig, 'execute')), 'authenticated can execute every staff RPC') from fns;
select ok(not bool_or(has_function_privilege('anon', sig, 'execute')), 'anon can execute none') from fns;
select ok(not bool_or(has_function_privilege('service_role', sig, 'execute')), 'service_role can execute none') from fns;
select ok(not bool_or(has_function_privilege('public', sig, 'execute')), 'public can execute none') from fns;
select ok(bool_and(p.prosecdef and p.proconfig @> array['search_path=""']), 'every staff RPC is security definer with an empty search_path')
from fns f join pg_proc p on p.oid = f.sig::regprocedure;
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'no API role can execute the private staff helpers')
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.is_org_owner(uuid)', 'private.staff_invitation_location_ids(uuid,boolean,uuid[])',
                  'private.insert_staff_invitation(uuid,text,uuid,boolean,uuid[],bytea)', 'private.staff_manage_org(uuid)',
                  'private.assert_can_act_on_member(public.organization_members)', 'private.org_has_custom_roles(uuid)',
                  'private.clean_role_name(text)', 'private.clean_permission_keys(text[])']) f;

-- ---------------------------------------------------------------------------------------------
-- No user
-- ---------------------------------------------------------------------------------------------
select pg_temp.nouid();
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('t0'), true, null)$$,
  '28000', 'UNAUTHENTICATED', 'create_staff_invitation needs a signed-in user');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'deactivated')$$, '28000', 'UNAUTHENTICATED', 'set_member_status needs a signed-in user');

-- ---------------------------------------------------------------------------------------------
-- create_staff_invitation
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), '  New.Cashier@Example.TEST ', pg_temp.role('staff-a', 'cashier'), pg_temp.h('t1'), false, array[pg_temp.loc('staff-a', 'One'), pg_temp.loc('staff-a', 'One'), null])$$,
  'the Owner invites a Cashier to one location');
select is((select count(*)::int from public.staff_invitations where email = 'new.cashier@example.test'), 1, 'the email is stored trimmed and lowercase');
select is((select invited_by from public.staff_invitations where email = 'new.cashier@example.test'), pg_temp.uuid_of(1), 'invited_by is the caller');
select is((select token_hash from public.staff_invitations where email = 'new.cashier@example.test'), pg_temp.h('t1'), 'only the given hash is stored');
select ok((select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days' from public.staff_invitations where email = 'new.cashier@example.test'), 'it expires after 7 days');
select is((select array_agg(location_id) from public.staff_invitation_locations where invitation_id = pg_temp.inv('new.cashier@example.test')),
  array[pg_temp.loc('staff-a', 'One')], 'one location row, duplicates and nulls dropped');
select is((select actor_id from public.audit_logs where action = 'staff_invitation.created' and entity_id = pg_temp.inv('new.cashier@example.test')::text),
  pg_temp.uuid_of(1), 'the audit row names the caller as actor');
select is(public.create_staff_invitation(pg_temp.org('staff-a'), 'all@example.test', pg_temp.role('staff-a', 'waiter'), pg_temp.h('t2'), true, null),
  pg_temp.inv('all@example.test'), 'returns the new invitation id (all locations)');
select is((select count(*)::int from public.staff_invitation_locations where invitation_id = pg_temp.inv('all@example.test')), 0, 'all_locations has no list');
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'empty@example.test', pg_temp.role('staff-a', 'manager'), pg_temp.h('t3'), false, array[]::uuid[])$$,
  'an empty list is allowed');

-- Refusals, each leaving nothing behind
create temp table before_snap (s text);
insert into before_snap select pg_temp.snap();
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'not-an-email', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x1'), true, null)$$, 'P0001', 'EMAIL_INVALID', 'a bad email');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), null, pg_temp.role('staff-a', 'cashier'), pg_temp.h('x2'), true, null)$$, 'P0001', 'EMAIL_INVALID', 'no email');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), '\x00'::bytea, true, null)$$, 'P0001', 'TOKEN_INVALID', 'a hash that is not 32 bytes');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), null, true, null)$$, 'P0001', 'TOKEN_INVALID', 'no hash');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('t1'), true, null)$$, 'P0001', 'TOKEN_INVALID', 'a hash already used');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-b', 'cashier'), pg_temp.h('x3'), true, null)$$, 'P0001', 'ROLE_INVALID', 'a role of another org');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', null, pg_temp.h('x4'), true, null)$$, 'P0001', 'ROLE_INVALID', 'no role');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x5'), false, array[pg_temp.loc('staff-b', 'Bee')])$$, 'P0001', 'LOCATION_INVALID', 'a location of another org');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x6'), false, array[gen_random_uuid()])$$, 'P0001', 'LOCATION_INVALID', 'an unknown location');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x7'), true, array[pg_temp.loc('staff-a', 'One')])$$, 'P0001', 'LOCATION_INVALID', 'a list with all_locations');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'x@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x8'), false, null)$$, 'P0001', 'LOCATION_INVALID', 'no list without all_locations');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), ' U3@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x9'), true, null)$$, 'P0001', 'ALREADY_MEMBER', 'the email of an active member');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'NEW.cashier@example.test', pg_temp.role('staff-a', 'waiter'), pg_temp.h('x10'), true, null)$$, 'P0001', 'INVITATION_EXISTS', 'a second open invitation for the same email');
select is(pg_temp.snap(), (select s from before_snap), 'none of the refusals left a row');

-- Plan limit: 6 active + 3 open = 9; at 9 the next invitation is refused, with no partial rows
update public.packages set max_staff = 9 where key = 'staff_test';
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'full@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x11'), false, array[pg_temp.loc('staff-a', 'One')])$$, 'P0001', 'PLAN_LIMIT:staff', 'PLAN_LIMIT:staff at the limit');
select is(pg_temp.snap(), (select s from before_snap), 'and leaves no invitation or location row');
update public.packages set max_staff = 20 where key = 'staff_test';

-- Escalation: the guards run as the caller
select pg_temp.uid(2);
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'boss@example.test', pg_temp.role('staff-a', 'owner'), pg_temp.h('x12'), true, null)$$, '42501', 'ESCALATION_DENIED', 'a Manager cannot invite an Owner');
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'mgr-cash@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('t4'), true, null)$$, 'a Manager invites a Cashier to all locations');
select pg_temp.uid(6);
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'sup-cash@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('x13'), false, array[pg_temp.loc('staff-a', 'One')])$$, '42501', 'ESCALATION_DENIED', 'a Supervisor cannot give a role with permissions they lack');
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'sup-kit@example.test', pg_temp.role('staff-a', 'kitchen'), pg_temp.h('t5'), false, array[pg_temp.loc('staff-a', 'One')])$$, 'a Supervisor invites Kitchen staff to a location they reach');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'sup-kit2@example.test', pg_temp.role('staff-a', 'kitchen'), pg_temp.h('x14'), false, array[pg_temp.loc('staff-a', 'Two')])$$, 'P0001', 'LOCATION_INVALID', 'but not to a location they do not reach');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'sup-kit2@example.test', pg_temp.role('staff-a', 'kitchen'), pg_temp.h('x15'), true, null)$$, 'P0001', 'LOCATION_INVALID', 'nor to all locations');

-- ---------------------------------------------------------------------------------------------
-- A Cashier (no staff.manage) gets FORBIDDEN from every RPC
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(3);
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'c@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('c1'), true, null)$$, '42501', 'FORBIDDEN', 'Cashier: create_staff_invitation');
select throws_ok($$select public.revoke_staff_invitation(pg_temp.inv('all@example.test'))$$, '42501', 'FORBIDDEN', 'Cashier: revoke_staff_invitation');
select throws_ok($$select public.resend_staff_invitation(pg_temp.inv('all@example.test'), pg_temp.h('c2'))$$, '42501', 'FORBIDDEN', 'Cashier: resend_staff_invitation');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 4), pg_temp.role('staff-a', 'cashier'))$$, '42501', 'FORBIDDEN', 'Cashier: change_member_role');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'deactivated')$$, '42501', 'FORBIDDEN', 'Cashier: set_member_status deactivated');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'active')$$, '42501', 'FORBIDDEN', 'Cashier: set_member_status active');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 3), 'deactivated')$$, '42501', 'FORBIDDEN', 'Cashier: not even on themself');

-- ---------------------------------------------------------------------------------------------
-- Cross tenant: the Owner of B, on ids of A, gets the same FORBIDDEN as for unknown ids
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(9);
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'b@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('b1'), true, null)$$, '42501', 'FORBIDDEN', 'cross tenant: invite into A');
select throws_ok($$select public.create_staff_invitation(pg_temp.org('staff-b'), 'b@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('b1'), true, null)$$, 'P0001', 'ROLE_INVALID', 'cross tenant: a role of A in B');
select throws_ok($$select public.revoke_staff_invitation(pg_temp.inv('all@example.test'))$$, '42501', 'FORBIDDEN', 'cross tenant: revoke_staff_invitation');
select throws_ok($$select public.resend_staff_invitation(pg_temp.inv('all@example.test'), pg_temp.h('b2'))$$, '42501', 'FORBIDDEN', 'cross tenant: resend_staff_invitation');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 4), pg_temp.role('staff-a', 'cashier'))$$, '42501', 'FORBIDDEN', 'cross tenant: change_member_role');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 4), pg_temp.role('staff-b', 'cashier'))$$, '42501', 'FORBIDDEN', 'cross tenant: change_member_role with own role');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'deactivated')$$, '42501', 'FORBIDDEN', 'cross tenant: set_member_status deactivated');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'active')$$, '42501', 'FORBIDDEN', 'cross tenant: set_member_status active');
select throws_ok($$select public.revoke_staff_invitation(gen_random_uuid())$$, '42501', 'FORBIDDEN', 'unknown invitation id: same FORBIDDEN');
select throws_ok($$select public.resend_staff_invitation(null, pg_temp.h('b3'))$$, '42501', 'FORBIDDEN', 'null invitation id: same FORBIDDEN');
select throws_ok($$select public.set_member_status(gen_random_uuid(), 'deactivated')$$, '42501', 'FORBIDDEN', 'unknown member id: same FORBIDDEN');
select throws_ok($$select public.create_staff_invitation(null, 'b@example.test', pg_temp.role('staff-a', 'cashier'), pg_temp.h('b4'), true, null)$$, '42501', 'FORBIDDEN', 'null org: same FORBIDDEN');
select is((select status from public.organization_members where id = pg_temp.member('staff-a', 4)), 'active', 'nothing changed in A');

-- ---------------------------------------------------------------------------------------------
-- revoke_staff_invitation
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'owner2@example.test', pg_temp.role('staff-a', 'owner'), pg_temp.h('t6'), true, null)$$, 'the Owner invites a second Owner');
select pg_temp.uid(2);
select throws_ok($$select public.revoke_staff_invitation(pg_temp.inv('owner2@example.test'))$$, '42501', 'ESCALATION_DENIED', 'a Manager cannot revoke an Owner invitation');
select throws_ok($$select public.resend_staff_invitation(pg_temp.inv('owner2@example.test'), pg_temp.h('x16'))$$, '42501', 'ESCALATION_DENIED', 'nor resend it');
select is((select count(*)::int from public.staff_invitations where email = 'owner2@example.test' and revoked_at is null), 1, 'which stays open, with no second row');
select lives_ok($$select public.revoke_staff_invitation(pg_temp.inv('mgr-cash@example.test'))$$, 'a Manager revokes a Cashier invitation');
select ok((select revoked_at is not null from public.staff_invitations where email = 'mgr-cash@example.test'), 'revoked_at is set');
select throws_ok($$select public.revoke_staff_invitation((select id from public.staff_invitations where email = 'mgr-cash@example.test'))$$, 'P0001', 'INVITATION_CLOSED', 'revoking twice');

-- ---------------------------------------------------------------------------------------------
-- resend_staff_invitation
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
create temp table old_inv as select id from public.staff_invitations where email = 'new.cashier@example.test';
create temp table new_inv (id uuid);
insert into new_inv select public.resend_staff_invitation((select id from old_inv), pg_temp.h('t7'));
select isnt((select id from new_inv), (select id from old_inv), 'resend returns a new id');
select is((select count(*)::int from public.staff_invitations where email = 'new.cashier@example.test' and accepted_at is null and revoked_at is null), 1, 'exactly one open invitation for the email');
select is(pg_temp.inv('new.cashier@example.test'), (select id from new_inv), 'and it is the new one');
select ok((select revoked_at is not null from public.staff_invitations where id = (select id from old_inv)), 'the old one is revoked');
select is((select role_id::text || '/' || all_locations || '/' || encode(token_hash, 'hex') from public.staff_invitations where id = (select id from new_inv)),
  pg_temp.role('staff-a', 'cashier')::text || '/false/' || encode(pg_temp.h('t7'), 'hex'), 'same role and flag, new hash');
select is((select array_agg(location_id) from public.staff_invitation_locations where invitation_id = (select id from new_inv)),
  array[pg_temp.loc('staff-a', 'One')], 'same location list');
select throws_ok($$select public.resend_staff_invitation((select id from old_inv), pg_temp.h('x17'))$$, 'P0001', 'INVITATION_CLOSED', 'resending a closed invitation');
delete from before_snap; insert into before_snap select pg_temp.snap();
select throws_ok($$select public.resend_staff_invitation((select id from new_inv), pg_temp.h('t1'))$$, 'P0001', 'TOKEN_INVALID', 'resend with a used hash');
select throws_ok($$select public.resend_staff_invitation((select id from new_inv), '\x01'::bytea)$$, 'P0001', 'TOKEN_INVALID', 'resend with a short hash');
select is(pg_temp.snap(), (select s from before_snap), 'a failed resend revokes nothing and adds nothing');
select is(pg_temp.inv('new.cashier@example.test'), (select id from new_inv), 'the invitation is still open');
-- Resend at the plan limit: the revoked one frees the slot the new one takes
update public.packages set max_staff = (select private.org_usage(pg_temp.org('staff-a'), 'staff', true)) where key = 'staff_test';
select lives_ok($$select public.resend_staff_invitation(pg_temp.inv('all@example.test'), pg_temp.h('t8'))$$, 'resend works at the plan limit');
update public.packages set max_staff = 20 where key = 'staff_test';
-- A Supervisor resending an invitation whose locations they no longer reach
select pg_temp.uid(1);
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'two@example.test', pg_temp.role('staff-a', 'kitchen'), pg_temp.h('t9'), false, array[pg_temp.loc('staff-a', 'Two')])$$, 'the Owner invites Kitchen staff to location Two');
select pg_temp.uid(6);
delete from before_snap; insert into before_snap select pg_temp.snap();
select throws_ok($$select public.resend_staff_invitation(pg_temp.inv('two@example.test'), pg_temp.h('x18'))$$, 'P0001', 'LOCATION_INVALID', 'a Supervisor cannot resend to a location they do not reach');
select is(pg_temp.snap(), (select s from before_snap), 'and the old invitation stays open');

-- ---------------------------------------------------------------------------------------------
-- change_member_role
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
select lives_ok($$select public.change_member_role(pg_temp.member('staff-a', 3), pg_temp.role('staff-a', 'waiter'))$$, 'the Owner makes the Cashier a Waiter');
select is((select role_id from public.organization_members where id = pg_temp.member('staff-a', 3)), pg_temp.role('staff-a', 'waiter'), 'the role changed');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 3), pg_temp.role('staff-b', 'cashier'))$$, 'P0001', 'ROLE_INVALID', 'a role of another org');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 1), pg_temp.role('staff-a', 'manager'))$$, '42501', 'ESCALATION_DENIED', 'the Owner cannot change their own role');
select pg_temp.uid(2);
delete from before_snap; insert into before_snap select pg_temp.snap();
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 1), pg_temp.role('staff-a', 'cashier'))$$, '42501', 'ESCALATION_DENIED', 'a Manager acting on an Owner');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 1), pg_temp.role('staff-a', 'owner'))$$, '42501', 'ESCALATION_DENIED', 'even as a no-op');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 4), pg_temp.role('staff-a', 'owner'))$$, '42501', 'ESCALATION_DENIED', 'a Manager cannot make someone an Owner');
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 2), pg_temp.role('staff-a', 'cashier'))$$, '42501', 'ESCALATION_DENIED', 'a Manager cannot change their own role');
select is(pg_temp.snap(), (select s from before_snap), 'no role changed');
select pg_temp.uid(6);
select throws_ok($$select public.change_member_role(pg_temp.member('staff-a', 5), pg_temp.role('staff-a', 'cashier'))$$, '42501', 'ESCALATION_DENIED', 'a Supervisor cannot give a role with permissions they lack');

-- ---------------------------------------------------------------------------------------------
-- set_member_status
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(2);
select is(public.set_member_status(pg_temp.member('staff-a', 4), 'deactivated'), pg_temp.uuid_of(4), 'set_member_status returns the member user id');
select is((select status from public.organization_members where id = pg_temp.member('staff-a', 4)), 'deactivated', 'the member is deactivated');
select ok((select deactivated_at is not null from public.organization_members where id = pg_temp.member('staff-a', 4)), 'with a time');
select is((select count(*)::int from auth.sessions where user_id = pg_temp.uuid_of(4)), 0, 'every session of the member is gone');
select is((select count(*)::int from auth.refresh_tokens where user_id = pg_temp.uuid_of(4)::text), 0, 'and their refresh tokens with them');
select is((select count(*)::int from auth.sessions where user_id = pg_temp.uuid_of(5)), 1, 'other users keep their sessions');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 5), 'sleeping')$$, 'P0001', 'STATUS_INVALID', 'an unknown status');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 5), null)$$, 'P0001', 'STATUS_INVALID', 'no status');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 2), 'deactivated')$$, '42501', 'ESCALATION_DENIED', 'nobody changes their own status');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'deactivated')$$, 'P0001', 'MEMBER_ALREADY_DEACTIVATED', 'deactivating twice');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 1), 'deactivated')$$, '42501', 'ESCALATION_DENIED', 'a Manager cannot deactivate an Owner');
select is((select count(*)::int from auth.sessions where user_id = pg_temp.uuid_of(1)), 1, 'and the Owner keeps their session');
select pg_temp.uid(6);
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'active')$$, '42501', 'ESCALATION_DENIED', 'a Supervisor cannot reactivate a Waiter (permissions they lack)');
select pg_temp.uid(1);
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 1), 'deactivated')$$, '42501', 'ESCALATION_DENIED', 'the only Owner cannot deactivate themself');
select is((select count(*)::int from auth.sessions where user_id = pg_temp.uuid_of(1)), 1, 'and keeps their session');
-- Reactivation takes a slot: at the limit it is refused
update public.packages set max_staff = (select private.org_usage(pg_temp.org('staff-a'), 'staff', true)) where key = 'staff_test';
delete from before_snap; insert into before_snap select pg_temp.snap();
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'active')$$, 'P0001', 'PLAN_LIMIT:staff', 'reactivation at the plan limit');
select is(pg_temp.snap(), (select s from before_snap), 'and changes nothing');
update public.packages set max_staff = 20 where key = 'staff_test';
select pg_temp.uid(2);
select lives_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'active')$$, 'a Manager reactivates the Waiter');
select is((select status || '/' || coalesce(deactivated_at::text, 'none') from public.organization_members where id = pg_temp.member('staff-a', 4)), 'active/none', 'active again, time cleared');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 4), 'active')$$, 'P0001', 'MEMBER_ALREADY_ACTIVE', 'reactivating an active member');
-- A deactivated member has no staff.manage any more
select pg_temp.uid(1);
select lives_ok($$select public.set_member_status(pg_temp.member('staff-a', 2), 'deactivated')$$, 'the Owner deactivates the Manager');
select pg_temp.uid(2);
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 2), 'active')$$, '42501', 'FORBIDDEN', 'who cannot reactivate themself');
select throws_ok($$select public.set_member_status(pg_temp.member('staff-a', 5), 'deactivated')$$, '42501', 'FORBIDDEN', 'nor act on anyone else');

-- ---------------------------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------------------------
select pg_temp.uid(1);
create temp table rid (name text, id uuid);
insert into rid select 'a', public.create_role(pg_temp.org('staff-a'), '  Bar Lead ', '  Runs the bar ', array['orders.view', 'kitchen.view', 'kitchen.view', null]);
select is((select name from public.roles where id = (select id from rid where name = 'a')), 'Bar Lead', 'create_role trims the name');
select is((select is_system::text || '/' || description from public.roles where id = (select id from rid where name = 'a')), 'false/Runs the bar', 'a custom role with a trimmed description');
select is((select array_agg(permission_key order by permission_key) from public.role_permissions where role_id = (select id from rid where name = 'a')), array['kitchen.view', 'orders.view'], 'permissions de-duplicated');
select is((select actor_id from public.audit_logs where action = 'role.created' and entity_id = (select id::text from rid where name = 'a')), pg_temp.uuid_of(1), 'the audit row names the caller');
delete from before_snap; insert into before_snap select pg_temp.snap();
create function pg_temp.roles_snap() returns text language sql as $$
  select (select count(*) from public.roles) || '/' || (select count(*) from public.role_permissions);
$$;
create temp table rsnap as select pg_temp.roles_snap() as s;
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'bar lead', null, array['orders.view'])$$, 'P0001', 'ROLE_NAME_TAKEN', 'a name already used (case-insensitive)');
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Owner', null, array['orders.view'])$$, 'P0001', 'ROLE_NAME_TAKEN', 'a system role name');
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), '   ', null, array['orders.view'])$$, 'P0001', 'NAME_INVALID', 'a blank name');
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), repeat('n', 61), null, array['orders.view'])$$, 'P0001', 'NAME_INVALID', 'a name over 60 characters');
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), E'\u00a0Odd', null, array['orders.view'])$$, 'P0001', 'NAME_INVALID', 'a name starting with a no-break space');
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Typo', null, array['orders.view', 'no.such.permission'])$$, 'P0001', 'PERMISSION_INVALID', 'an unknown permission key');
select is(pg_temp.roles_snap(), (select s from rsnap), 'none of them left a role or permission row');
select lives_ok($$select public.create_role(pg_temp.org('staff-a'), 'Empty', null, null)$$, 'no permission list is an empty role');

select pg_temp.uid(6);
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Greedy', null, array['kitchen.view', 'reports.view'])$$, '42501', 'ESCALATION_DENIED', 'a Supervisor cannot grant a permission they lack');
select is(pg_temp.roles_snap(), (select s from rsnap), 'and no half-created role is left (empty role from above included)') where false;
select is((select count(*)::int from public.roles where name = 'Greedy'), 0, 'the refused role does not exist');
select lives_ok($$select public.create_role(pg_temp.org('staff-a'), 'Kitchen Plus', null, array['kitchen.view', 'orders.view'])$$, 'but can grant what they hold');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), null, null, array['reports.view'])$$, '42501', 'ESCALATION_DENIED', 'update: a permission they lack');
select throws_ok($$select public.update_role((select id from public.roles where name = 'Kitchen Plus'), null, null, array['kitchen.view', 'reports.view'])$$, '42501', 'ESCALATION_DENIED', 'update: adding a permission they lack, on their own role');
select is((select array_agg(permission_key order by permission_key) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.name = 'Kitchen Plus'), array['kitchen.view', 'orders.view'], 'and the permissions are unchanged');

-- A role holding a permission the caller lacks can't be edited or deleted by them
select pg_temp.uid(1);
insert into rid select 'rep', public.create_role(pg_temp.org('staff-a'), 'Reporter', null, array['reports.view']);
select pg_temp.uid(6);
select throws_ok($$select public.update_role((select id from rid where name = 'rep'), 'Renamed', null, null)$$, '42501', 'ESCALATION_DENIED', 'update: a role with a permission they lack');
select throws_ok($$select public.delete_role((select id from rid where name = 'rep'))$$, '42501', 'ESCALATION_DENIED', 'delete: a role with a permission they lack');

select pg_temp.uid(1);
select lives_ok($$select public.update_role((select id from rid where name = 'a'), 'Bar Boss', 'New text', array['orders.view', 'reports.view'])$$, 'the Owner updates name, description and permissions');
select is((select name || '/' || description from public.roles where id = (select id from rid where name = 'a')), 'Bar Boss/New text', 'name and description changed');
select is((select array_agg(permission_key order by permission_key) from public.role_permissions where role_id = (select id from rid where name = 'a')), array['orders.view', 'reports.view'], 'permissions replaced: one kept, one removed, one added');
select lives_ok($$select public.update_role((select id from rid where name = 'a'), null, null, null)$$, 'a null name and permission list keep them');
select is((select name from public.roles where id = (select id from rid where name = 'a')), 'Bar Boss', 'the name is kept');
select is((select count(*)::int from public.role_permissions where role_id = (select id from rid where name = 'a')), 2, 'and so are the permissions');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), 'reporter', null, null)$$, 'P0001', 'ROLE_NAME_TAKEN', 'update: a name already used');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), 'Bar Boss', null, array['no.such.permission'])$$, 'P0001', 'PERMISSION_INVALID', 'update: an unknown permission');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), ' ', null, null)$$, 'P0001', 'NAME_INVALID', 'update: a blank name');
select is((select array_agg(permission_key order by permission_key) from public.role_permissions where role_id = (select id from rid where name = 'a')), array['orders.view', 'reports.view'], 'a refused update changes nothing');
select throws_ok($$select public.update_role(pg_temp.role('staff-a', 'cashier'), 'Till', null, null)$$, 'P0001', 'ROLE_SYSTEM', 'update: a system role');
select throws_ok($$select public.delete_role(pg_temp.role('staff-a', 'cashier'))$$, 'P0001', 'ROLE_SYSTEM', 'delete: a system role');

-- In use: a member, an open invitation, or a closed one
select throws_ok($$select public.delete_role(pg_temp.role('staff-a', 'Supervisor'))$$, 'P0001', 'ROLE_IN_USE', 'delete: a role a member holds');
select lives_ok($$select public.create_staff_invitation(pg_temp.org('staff-a'), 'barlead@example.test', (select id from rid where name = 'a'), pg_temp.h('r1'), true, null)$$, 'invite someone to Bar Boss');
select throws_ok($$select public.delete_role((select id from rid where name = 'a'))$$, 'P0001', 'ROLE_IN_USE', 'delete: a role an open invitation holds');
select lives_ok($$select public.revoke_staff_invitation(pg_temp.inv('barlead@example.test'))$$, 'revoke it');
select throws_ok($$select public.delete_role((select id from rid where name = 'a'))$$, 'P0001', 'ROLE_IN_USE', 'delete: a closed invitation still points at the role');
select lives_ok($$select public.delete_role((select id from rid where name = 'rep'))$$, 'delete: an unused custom role');
select is((select count(*)::int from public.roles where id = (select id from rid where name = 'rep')) + (select count(*)::int from public.role_permissions where role_id = (select id from rid where name = 'rep')), 0, 'the role and its permissions are gone');
select is((select count(*)::int from public.audit_logs where action = 'role.deleted' and entity_id = (select id::text from rid where name = 'rep')), 1, 'the deletion is audited');

-- Members hold roles: a custom role can be given and the guard still holds
select lives_ok($$select public.change_member_role(pg_temp.member('staff-a', 5), (select id from rid where name = 'a'))$$, 'a custom role is given to a member');
select throws_ok($$select public.delete_role((select id from rid where name = 'a'))$$, 'P0001', 'ROLE_IN_USE', 'which then holds it');

-- Cashier and cross tenant
select pg_temp.uid(3);
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Nope', null, null)$$, '42501', 'FORBIDDEN', 'Cashier: create_role');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), 'Nope', null, null)$$, '42501', 'FORBIDDEN', 'Cashier: update_role');
select throws_ok($$select public.delete_role((select id from rid where name = 'a'))$$, '42501', 'FORBIDDEN', 'Cashier: delete_role');
select pg_temp.uid(9);
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Nope', null, null)$$, '42501', 'FORBIDDEN', 'cross tenant: create_role');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), 'Nope', null, null)$$, '42501', 'FORBIDDEN', 'cross tenant: update_role');
select throws_ok($$select public.delete_role((select id from rid where name = 'a'))$$, '42501', 'FORBIDDEN', 'cross tenant: delete_role');
select throws_ok($$select public.delete_role(gen_random_uuid())$$, '42501', 'FORBIDDEN', 'unknown role id: same FORBIDDEN');
select throws_ok($$select public.update_role(null, 'Nope', null, null)$$, '42501', 'FORBIDDEN', 'null role id: same FORBIDDEN');

-- The custom_roles feature
select pg_temp.uid(1);
update public.packages set feature_custom_roles = false where key = 'staff_test';
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Gated', null, null)$$, 'P0001', 'PLAN_FEATURE:custom_roles', 'create_role needs the custom_roles feature');
select throws_ok($$select public.update_role((select id from rid where name = 'a'), 'Gated', null, null)$$, 'P0001', 'PLAN_FEATURE:custom_roles', 'update_role needs it');
update public.subscriptions set status = 'canceled', canceled_at = now() where org_id = pg_temp.org('staff-a');
update public.packages set feature_custom_roles = true where key = 'staff_test';
select throws_ok($$select public.create_role(pg_temp.org('staff-a'), 'Gated', null, null)$$, 'P0001', 'PLAN_FEATURE:custom_roles', 'no current subscription: no custom roles (fails closed)');
update public.subscriptions set status = 'active', canceled_at = null where org_id = pg_temp.org('staff-a');

-- ---------------------------------------------------------------------------------------------
-- No other tenant's data: B's rows are untouched by all of the above
-- ---------------------------------------------------------------------------------------------
select pg_temp.nouid();
select is((select count(*)::int from public.staff_invitations where org_id = pg_temp.org('staff-b')), 0, 'no invitation landed in B');
select is((select count(*)::int from public.audit_logs where org_id = pg_temp.org('staff-b') and action like 'staff_invitation%'), 0, 'no staff audit row in B');

select * from finish();
rollback;
