-- M0-BE-10: helpers fail closed; member read policies; client RPCs return only the caller's data.
begin;
select plan(98);

-- ---------------------------------------------------------------------------------------------
-- Fixture. Org one (active) has one member per system role, a deactivated cashier and a
-- location-limited waiter. Org two is another tenant. Org three is suspended.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@example.test'
from generate_series(1, 12) n;
-- 1 owner1, 2 manager1, 3 cashier1, 4 waiter1 (loc A only), 5 kitchen1, 6 deactivated cashier1,
-- 7 owner2, 8 non-member, 9 owner3 (suspended org), 10 platform admin, 11 manager1 on loc-less, 12 spare

insert into public.organizations (name, slug) values ('One', 'org-one'), ('Two', 'org-two'), ('Three', 'org-three');
update public.organizations set status = 'suspended' where slug = 'org-three';

create temp table ctx on commit drop as
select
  (select id from public.organizations where slug = 'org-one') as o1,
  (select id from public.organizations where slug = 'org-two') as o2,
  (select id from public.organizations where slug = 'org-three') as o3;

insert into public.locations (org_id, name) select o1, 'A' from ctx union all select o1, 'B' from ctx union all select o2, 'C' from ctx union all select o3, 'D' from ctx;
insert into public.org_branding (org_id) select o1 from ctx union all select o2 from ctx;

create function pg_temp.add_member(p_org uuid, p_user int, p_key text) returns uuid language sql as $$
  insert into public.organization_members (org_id, user_id, role_id)
  select p_org, ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0'))::uuid, r.id
  from public.roles r where r.org_id = p_org and r.system_key = p_key
  returning id;
$$;

select pg_temp.add_member(o1, 1, 'owner') from ctx;
select pg_temp.add_member(o1, 2, 'manager') from ctx;
select pg_temp.add_member(o1, 3, 'cashier') from ctx;
select pg_temp.add_member(o1, 4, 'waiter') from ctx;
select pg_temp.add_member(o1, 5, 'kitchen') from ctx;
select pg_temp.add_member(o1, 6, 'cashier') from ctx;
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000006';
select pg_temp.add_member(o2, 7, 'owner') from ctx;
select pg_temp.add_member(o3, 9, 'owner') from ctx;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000010');

-- waiter works at location A only
insert into public.location_staff (member_id, location_id, org_id)
select m.id, l.id, m.org_id from public.organization_members m join public.locations l on l.org_id = m.org_id and l.name = 'A'
where m.user_id = '00000000-0000-0000-0000-000000000004';
-- cashier works at A and B
insert into public.location_staff (member_id, location_id, org_id)
select m.id, l.id, m.org_id from public.organization_members m join public.locations l on l.org_id = m.org_id
where m.user_id = '00000000-0000-0000-0000-000000000003';
-- the deactivated cashier still has a staff row
insert into public.location_staff (member_id, location_id, org_id)
select m.id, l.id, m.org_id from public.organization_members m join public.locations l on l.org_id = m.org_id and l.name = 'A'
where m.user_id = '00000000-0000-0000-0000-000000000006';

insert into public.subscriptions (org_id, package_id, status, trial_ends_at, current_period_end)
select o1, (select id from public.packages where is_default), 'trialing', now() + interval '14 days', now() + interval '14 days' from ctx;
insert into public.audit_logs (org_id, action) select o1, 'seed.one' from ctx union all select o2, 'seed.two' from ctx;

create temp table locs on commit drop as
select o.slug, l.name, l.id from public.locations l join public.organizations o on o.id = l.org_id;
grant select on ctx, locs to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Grants: anon gets nothing, authenticated only what policies need, server-side helpers none
-- ---------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'private.has_permission(uuid,text)', 'execute'), 'anon cannot run has_permission');
select ok(not has_function_privilege('anon', 'private.is_org_member(uuid)', 'execute'), 'anon cannot run is_org_member');
select ok(not has_function_privilege('anon', 'private.is_platform_admin()', 'execute'), 'anon cannot run is_platform_admin');
select ok(not has_function_privilege('anon', 'public.my_permissions(uuid)', 'execute'), 'anon cannot run my_permissions');
select ok(not has_function_privilege('anon', 'public.get_org_package(uuid)', 'execute'), 'anon cannot run get_org_package');
select ok(not has_function_privilege('anon', 'public.my_org_membership(uuid)', 'execute'), 'anon cannot run my_org_membership');
select ok(has_function_privilege('authenticated', 'private.has_permission(uuid,text)', 'execute'), 'authenticated can run has_permission');
select ok(not has_function_privilege('authenticated', 'private.org_limit(uuid,text)', 'execute'), 'authenticated cannot run org_limit');
select ok(not has_function_privilege('service_role', 'private.org_limit(uuid,text)', 'execute'), 'service_role cannot run org_limit');
select ok(not has_function_privilege('authenticated', 'private.write_audit(uuid,text,text,text,jsonb)', 'execute'), 'authenticated cannot run write_audit');
select ok(not has_function_privilege('service_role', 'private.write_audit(uuid,text,text,text,jsonb)', 'execute'), 'service_role cannot run write_audit');
select ok(not has_table_privilege('anon', 'public.organizations', 'select'), 'anon cannot read organizations');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'insert'), 'authenticated cannot write organizations');
select ok(not has_table_privilege('authenticated', 'public.staff_invitations', 'select'), 'invitations stay server-only');

-- ---------------------------------------------------------------------------------------------
-- has_permission, per role, against PLAN 4.2.1
-- ---------------------------------------------------------------------------------------------
create temp table expected (user_no int, permission_key text) on commit drop;
insert into expected select 1, key from public.permissions;                                    -- owner: all
insert into expected select 2, key from public.permissions where key not in ('billing.manage','settings.manage','locations.manage');
insert into expected select 3, unnest(array['pos.use','orders.view','orders.create','bills.print','payments.view','payments.take','customers.view','kitchen.view','tables.view']);
insert into expected select 4, unnest(array['pos.use','orders.view','orders.create','bills.print','kitchen.view','tables.view','reservations.view']);
insert into expected select 5, unnest(array['kitchen.view','kitchen.update','orders.view']);
create temp table perms on commit drop as select key from public.permissions;
grant select on expected, perms to authenticated;

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from perms p where private.has_permission((select o1 from ctx), p.key) is distinct from true) , 0, 'owner has all 24 permissions') ;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from (select key from perms p where private.has_permission((select o1 from ctx), p.key)
  except select permission_key from expected where user_no = 2) x), 0, 'manager has nothing extra');
select is((select count(*)::int from (select permission_key from expected where user_no = 2
  except select key from perms p where private.has_permission((select o1 from ctx), p.key)) x), 0, 'manager has nothing missing');
select ok(not private.has_permission((select o1 from ctx), 'billing.manage'), 'manager lacks billing.manage');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from (select key from perms p where private.has_permission((select o1 from ctx), p.key)
  except select permission_key from expected where user_no = 3) x), 0, 'cashier has nothing extra');
select is((select count(*)::int from (select permission_key from expected where user_no = 3
  except select key from perms p where private.has_permission((select o1 from ctx), p.key)) x), 0, 'cashier has nothing missing');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from (select key from perms p where private.has_permission((select o1 from ctx), p.key)
  except select permission_key from expected where user_no = 4) x), 0, 'waiter has nothing extra');
select is((select count(*)::int from (select permission_key from expected where user_no = 4
  except select key from perms p where private.has_permission((select o1 from ctx), p.key)) x), 0, 'waiter has nothing missing');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from (select key from perms p where private.has_permission((select o1 from ctx), p.key)
  except select permission_key from expected where user_no = 5) x), 0, 'kitchen has nothing extra');
select is((select count(*)::int from (select permission_key from expected where user_no = 5
  except select key from perms p where private.has_permission((select o1 from ctx), p.key)) x), 0, 'kitchen has nothing missing');

-- Fails closed
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.has_permission((select o1 from ctx), 'nope.nope'), false, 'unknown permission: false even for owner');
select is(private.has_permission((select o1 from ctx), null), false, 'null permission: false');
select is(private.has_permission(null, 'pos.use'), false, 'null org: false');
select is(private.has_permission(gen_random_uuid(), 'pos.use'), false, 'unknown org: false');
select is(private.has_permission((select o2 from ctx), 'pos.use'), false, 'owner of org one has nothing in org two');
select is(private.is_org_member((select o2 from ctx)), false, 'not a member of another tenant');
select is(private.is_org_member((select o1 from ctx)), true, 'member of own org');
select is(private.is_org_member(null), false, 'is_org_member(null)');
-- deactivated member
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(private.has_permission((select o1 from ctx), 'pos.use'), false, 'deactivated member: no permission');
select is(private.is_org_member((select o1 from ctx)), false, 'deactivated member: not a member');
select is(private.has_location_access((select o1 from ctx), (select id from locs where slug = 'org-one' and name = 'A')), false, 'deactivated member: no location access');
-- suspended org
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(private.has_permission((select o3 from ctx), 'settings.manage'), false, 'suspended org: no permission even for its owner');
select is(private.is_org_member((select o3 from ctx)), false, 'suspended org: not a member');
select is(private.has_location_access((select o3 from ctx), (select id from locs where slug = 'org-three')), false, 'suspended org: no location access');
-- non-member and no user
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(private.has_permission((select o1 from ctx), 'pos.use'), false, 'non-member: no permission');
select set_config('request.jwt.claims', '', true);
select is(private.has_permission((select o1 from ctx), 'pos.use'), false, 'no user: no permission');
select is(private.is_platform_admin(), false, 'no user: not a platform admin');

-- ---------------------------------------------------------------------------------------------
-- has_location_access
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from locs l where l.slug = 'org-one' and private.has_location_access((select o1 from ctx), l.id)), 2, 'owner sees both locations');
select is(private.has_location_access((select o1 from ctx), (select id from locs where slug = 'org-two')), false, 'owner cannot reach another org''s location');
select is(private.has_location_access((select o2 from ctx), (select id from locs where slug = 'org-one' and name = 'A')), false, 'location must belong to the org given');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from locs l where l.slug = 'org-one' and private.has_location_access((select o1 from ctx), l.id)), 2, 'manager sees both locations');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(private.has_location_access((select o1 from ctx), (select id from locs where slug = 'org-one' and name = 'A')), true, 'waiter reaches location A');
select is(private.has_location_access((select o1 from ctx), (select id from locs where slug = 'org-one' and name = 'B')), false, 'waiter does not reach location B');
select is(private.has_location_access((select o1 from ctx), null), false, 'null location: false');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from locs l where l.slug = 'org-one' and private.has_location_access((select o1 from ctx), l.id)), 0, 'staff without location rows reach none');

-- is_platform_admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select is(private.is_platform_admin(), true, 'platform admin');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.is_platform_admin(), false, 'org owner is not a platform admin');

-- ---------------------------------------------------------------------------------------------
-- Read policies
-- ---------------------------------------------------------------------------------------------
-- owner of org one
select is((select count(*)::int from public.organizations), 1, 'owner: sees only own organization');
select is((select count(*)::int from public.locations), 2, 'owner: both locations');
select is((select count(*)::int from public.org_branding), 1, 'owner: branding');
select is((select count(*)::int from public.roles), 5, 'owner: five roles');
select ok((select count(*) from public.role_permissions) > 0, 'owner: role permissions');
select is((select count(*)::int from public.organization_members), 6, 'owner: all six members (staff.manage)');
select ok((select count(*) from public.location_staff) > 0, 'owner: location staff');
select is((select count(*)::int from public.audit_logs), 1, 'owner: only own org audit rows');
select throws_ok($$update public.organizations set name = 'Hacked'$$, '42501', null, 'owner: no write through the API');
select throws_ok($$insert into public.audit_logs (org_id, action) select o1, 'x' from ctx$$, '42501', null, 'owner: cannot write audit rows');

-- manager: members yes, audit no
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.organization_members), 6, 'manager: staff list (staff.manage)');
select is((select count(*)::int from public.audit_logs), 0, 'manager: no audit log (needs settings.manage)');
-- waiter: own member row, own locations only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.organization_members), 1, 'waiter: only own member row');
select is((select count(*)::int from public.locations), 1, 'waiter: only own location');
select is((select count(*)::int from public.location_staff), 1, 'waiter: only own location link');
select is((select count(*)::int from public.organizations), 1, 'waiter: own organization');
select is((select count(*)::int from public.audit_logs), 0, 'waiter: no audit log');
-- other tenant
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is((select count(*)::int from public.organizations where id = (select o1 from ctx)), 0, 'other tenant: cannot see org one');
select is((select count(*)::int from public.organization_members where org_id = (select o1 from ctx)), 0, 'other tenant: no org one members');
select is((select count(*)::int from public.roles where org_id = (select o1 from ctx)), 0, 'other tenant: no org one roles');
select is((select count(*)::int from public.audit_logs where org_id = (select o1 from ctx)), 0, 'other tenant: no org one audit rows');
-- deactivated, suspended, non-member: every table empty
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from (select 1 from public.organizations union all select 1 from public.locations union all select 1 from public.org_branding
  union all select 1 from public.roles union all select 1 from public.role_permissions union all select 1 from public.organization_members
  union all select 1 from public.location_staff union all select 1 from public.audit_logs) x), 0, 'deactivated member: no rows anywhere');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is((select count(*)::int from (select 1 from public.organizations union all select 1 from public.locations union all select 1 from public.org_branding
  union all select 1 from public.roles union all select 1 from public.role_permissions union all select 1 from public.organization_members
  union all select 1 from public.location_staff union all select 1 from public.audit_logs) x), 0, 'suspended org: no rows anywhere');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from (select 1 from public.organizations union all select 1 from public.locations union all select 1 from public.org_branding
  union all select 1 from public.roles union all select 1 from public.role_permissions union all select 1 from public.organization_members
  union all select 1 from public.location_staff union all select 1 from public.audit_logs) x), 0, 'non-member: no rows anywhere');

-- ---------------------------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select array_agg(k order by k) from public.my_permissions((select o1 from ctx)) k), array['kitchen.update','kitchen.view','orders.view'], 'my_permissions: kitchen');
select is((select count(*)::int from public.my_permissions((select o2 from ctx))), 0, 'my_permissions: nothing in another org');
select is((select count(*)::int from public.my_permissions(null)), 0, 'my_permissions(null)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.my_permissions((select o1 from ctx))), 24, 'my_permissions: owner has 24');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from public.my_permissions((select o1 from ctx))), 0, 'my_permissions: deactivated has none');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is((select count(*)::int from public.my_permissions((select o3 from ctx))), 0, 'my_permissions: suspended org has none');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select package_key from public.get_org_package((select o1 from ctx))), 'trial', 'get_org_package: member sees the package');
select is((select subscription_status from public.get_org_package((select o1 from ctx))), 'trialing', 'get_org_package: status');
select is((select (features ->> 'loyalty')::boolean from public.get_org_package((select o1 from ctx))), false, 'get_org_package: features object');
select is((select count(*)::int from public.get_org_package((select o2 from ctx))), 0, 'get_org_package: another tenant''s package is not visible');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from public.get_org_package((select o1 from ctx))), 0, 'get_org_package: deactivated sees nothing');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.my_org_membership()), 1, 'my_org_membership: only the caller''s own rows');
select is((select role_key from public.my_org_membership((select o1 from ctx))), 'cashier', 'my_org_membership: role');
select is((select count(*)::int from public.my_org_membership((select o2 from ctx))), 0, 'my_org_membership: none for another org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select member_status from public.my_org_membership()), 'deactivated', 'my_org_membership: shows deactivated so the app can say so');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from public.my_org_membership()), 0, 'my_org_membership: non-member has none');

reset role;

-- ---------------------------------------------------------------------------------------------
-- Server-side helpers (run as postgres)
-- ---------------------------------------------------------------------------------------------
select is(private.org_limit((select o1 from ctx), 'locations'), 1, 'org_limit: locations from the current package');
select is(private.org_limit((select o1 from ctx), 'staff'), 5, 'org_limit: staff');
select is(private.org_limit((select o2 from ctx), 'tables'), 0, 'org_limit: no subscription fails closed to 0');
select throws_ok($$select private.org_limit((select o1 from ctx), 'bananas')$$, '22023', null, 'org_limit: unknown key raises');
update public.packages set max_tables = null where is_default;
select is(private.org_limit((select o1 from ctx), 'tables'), null, 'org_limit: null means unlimited');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$select private.write_audit((select o1 from ctx), 'test.action', 'thing', 'abc', '{"field":"name"}')$$, 'write_audit inserts');
select is((select actor_id from public.audit_logs where action = 'test.action'), '00000000-0000-0000-0000-000000000001'::uuid, 'write_audit records auth.uid() as actor');

select * from finish();
rollback;
