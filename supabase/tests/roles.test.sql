-- M0-BE-08: role catalog, cross-tenant links, system role protection, no client access.
begin;
select plan(60);

select has_table('public'::name, t::name)
from unnest(array['permissions','default_role_permissions','roles','role_permissions','organization_members','location_staff']) t;
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.permissions'::regclass,'public.default_role_permissions'::regclass,'public.roles'::regclass,
  'public.role_permissions'::regclass,'public.organization_members'::regclass,'public.location_staff'::regclass)), 'RLS on every table');

select is((select count(*)::int from public.permissions), 24, '24 permissions in the catalog');

insert into public.organizations (name, slug) values ('Org One', 'org-one'), ('Org Two', 'org-two');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test');

-- Five system roles per org
select is((select count(*)::int from public.roles where is_system and org_id = (select id from public.organizations where slug = 'org-one')), 5, 'five system roles in org one');
select is((select count(*)::int from public.roles where is_system and org_id = (select id from public.organizations where slug = 'org-two')), 5, 'five system roles in org two');
select is((select string_agg(system_key, ',' order by system_key) from public.roles where org_id = (select id from public.organizations where slug = 'org-one')), 'cashier,kitchen,manager,owner,waiter', 'the five keys');

-- Every role-permission pair matches PLAN section 4.2.1, for both orgs
create temp table expected (role_key text, permission_key text) on commit drop;
insert into expected
select 'manager', key from public.permissions where key not in ('billing.manage','settings.manage','locations.manage');
insert into expected values
  ('cashier','pos.use'),('cashier','orders.view'),('cashier','orders.create'),('cashier','bills.print'),('cashier','payments.view'),
  ('cashier','payments.take'),('cashier','customers.view'),('cashier','kitchen.view'),('cashier','tables.view'),
  ('waiter','pos.use'),('waiter','orders.view'),('waiter','orders.create'),('waiter','bills.print'),('waiter','kitchen.view'),
  ('waiter','tables.view'),('waiter','reservations.view'),
  ('kitchen','kitchen.view'),('kitchen','kitchen.update'),('kitchen','orders.view');

create temp table actual on commit drop as
select o.slug, r.system_key as role_key, rp.permission_key
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
join public.organizations o on o.id = r.org_id;

select is((select count(*)::int from (
  select s.slug, e.role_key, e.permission_key from expected e cross join (select distinct slug from actual) s
  except select slug, role_key, permission_key from actual) x), 0, 'no catalog pair is missing');
select is((select count(*)::int from (
  select slug, role_key, permission_key from actual
  except select s.slug, e.role_key, e.permission_key from expected e cross join (select distinct slug from actual) s) x), 0, 'no extra pair');
select is((select count(*)::int from actual where role_key = 'owner'), 0, 'owner has no rows (implicit everything)');
select is((select count(*)::int from actual where role_key = 'manager' and slug = 'org-one'), 21, 'manager has 21');
select is((select count(*)::int from actual where role_key = 'cashier' and slug = 'org-one'), 9, 'cashier has 9');
select is((select count(*)::int from actual where role_key = 'waiter' and slug = 'org-one'), 7, 'waiter has 7');
select is((select count(*)::int from actual where role_key = 'kitchen' and slug = 'org-one'), 3, 'kitchen has 3');

-- System roles can't be changed or deleted by service_role (postgres, the migration owner, may)
set local role service_role;
select throws_ok($$update public.roles set name = 'Boss' where system_key = 'owner'$$, '42501', null, 'system role rename refused');
select throws_ok($$update public.roles set is_system = false, system_key = null where system_key = 'owner'$$, '42501', null, 'system role demotion refused');
select throws_ok($$delete from public.roles where system_key = 'cashier'$$, '42501', null, 'system role delete refused');
select throws_ok($$insert into public.roles (org_id, system_key, is_system, name) select id, 'owner', true, 'Owner2' from public.organizations where slug = 'org-one'$$, '42501', null, 'cannot create a system role by hand');
select throws_ok($$delete from public.role_permissions where permission_key = 'pos.use'$$, '42501', null, 'system role permission delete refused');
select throws_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'billing.manage' from public.roles where system_key = 'cashier' and org_id = (select id from public.organizations where slug = 'org-one')$$, '42501', null, 'system role permission add refused');
reset role;

-- Custom roles
insert into public.roles (org_id, name) select id, 'Host' from public.organizations where slug = 'org-one';
insert into public.roles (org_id, name) select id, 'Host' from public.organizations where slug = 'org-two';
select throws_ok($$insert into public.roles (org_id, name) select id, 'host' from public.organizations where slug = 'org-one'$$, '23505', null, 'role names unique per org (case-insensitive)');
set local role service_role;
select throws_ok($$update public.roles set is_system = true, system_key = 'owner' where name = 'Host' and org_id = (select id from public.organizations where slug = 'org-one')$$, '42501', null, 'custom role cannot be promoted by service_role');
reset role;
select lives_ok($$update public.roles set name = 'Host stand' where name = 'Host' and org_id = (select id from public.organizations where slug = 'org-one')$$, 'custom role can be renamed');
set local role service_role;
select lives_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'tables.view' from public.roles where name = 'Host stand'$$, 'service_role adds a custom role permission');
select lives_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'orders.view' from public.roles where name = 'Host stand'$$, 'service_role adds another');
select lives_ok($$delete from public.role_permissions where permission_key = 'orders.view' and role_id = (select id from public.roles where name = 'Host stand')$$, 'service_role removes a custom role permission');
select lives_ok($$update public.roles set description = 'Front of house' where name = 'Host stand'$$, 'service_role edits a custom role');
reset role;
select throws_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'nope.nope' from public.roles where name = 'Host stand'$$, '23503', null, 'unknown permission refused');
-- Cross-tenant: role from org one with org two's id
select throws_ok($$insert into public.role_permissions (role_id, org_id, permission_key)
  select r.id, (select id from public.organizations where slug = 'org-two'), 'pos.use' from public.roles r where r.name = 'Host stand'$$, '23503', null, 'role_permission cannot point at another org''s role');
select lives_ok($$delete from public.roles where name = 'Host' and org_id = (select id from public.organizations where slug = 'org-two')$$, 'custom role can be deleted');

-- Members
select lives_ok($$insert into public.organization_members (org_id, user_id, role_id)
  select r.org_id, '00000000-0000-0000-0000-0000000000a1', r.id from public.roles r where r.system_key = 'owner' and r.org_id = (select id from public.organizations where slug = 'org-one')$$, 'owner member');
select throws_ok($$insert into public.organization_members (org_id, user_id, role_id)
  select r.org_id, '00000000-0000-0000-0000-0000000000a1', r.id from public.roles r where r.system_key = 'waiter' and r.org_id = (select id from public.organizations where slug = 'org-one')$$, '23505', null, 'one row per (org, user)');
select throws_ok($$insert into public.organization_members (org_id, user_id, role_id)
  select (select id from public.organizations where slug = 'org-two'), '00000000-0000-0000-0000-0000000000b2', r.id
  from public.roles r where r.system_key = 'owner' and r.org_id = (select id from public.organizations where slug = 'org-one')$$, '23503', null, 'member cannot take another org''s role');
select lives_ok($$insert into public.organization_members (org_id, user_id, role_id)
  select r.org_id, '00000000-0000-0000-0000-0000000000b2', r.id from public.roles r where r.system_key = 'cashier' and r.org_id = (select id from public.organizations where slug = 'org-two')$$, 'member in org two');
select throws_ok($$update public.organization_members set status = 'gone'$$, '23514', null, 'status check');
select throws_ok($$update public.organization_members set status = 'deactivated' where user_id = '00000000-0000-0000-0000-0000000000b2'$$, '23514', null, 'deactivated needs a time');
select lives_ok($$update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-0000000000b2'$$, 'deactivate');
select lives_ok($$insert into public.organization_members (org_id, user_id, role_id)
  select r.org_id, '00000000-0000-0000-0000-0000000000b2', r.id from public.roles r where r.name = 'Host stand'$$, 'member with a custom role');
select throws_ok($$delete from public.roles where name = 'Host stand'$$, '23503', null, 'role in use cannot be deleted');

-- location_staff
insert into public.locations (org_id, name) select id, 'Main one' from public.organizations where slug = 'org-one';
insert into public.locations (org_id, name) select id, 'Main two' from public.organizations where slug = 'org-two';
select lives_ok($$insert into public.location_staff (member_id, location_id, org_id)
  select m.id, l.id, m.org_id from public.organization_members m join public.locations l on l.org_id = m.org_id where m.user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'link member to own location');
select throws_ok($$insert into public.location_staff (member_id, location_id, org_id)
  select m.id, l.id, m.org_id from public.organization_members m, public.locations l
  where m.user_id = '00000000-0000-0000-0000-0000000000a1' and l.name = 'Main two'$$, '23503', null, 'member cannot be linked to another tenant''s location');

-- Cascade: deleting an org removes its system roles even though they are protected
select lives_ok($$delete from public.organizations where slug = 'org-two'$$, 'org delete cascades through system roles');
select is((select count(*)::int from public.roles where org_id not in (select id from public.organizations)), 0, 'no orphan roles');

-- Backfill path: an organization that exists without roles (as on hosted before this migration)
alter table public.organizations disable trigger organizations_seed_roles;
insert into public.organizations (name, slug) values ('Legacy', 'legacy-org');
alter table public.organizations enable trigger organizations_seed_roles;
select is((select count(*)::int from public.roles where org_id = (select id from public.organizations where slug = 'legacy-org')), 0, 'legacy org starts without roles');
select lives_ok($$select private.seed_org_roles((select id from public.organizations where slug = 'legacy-org'))$$, 'backfill runs as postgres');
select is((select count(*)::int from public.roles where is_system and org_id = (select id from public.organizations where slug = 'legacy-org')), 5, 'backfill seeds five system roles');
select is((select count(*)::int from public.role_permissions where org_id = (select id from public.organizations where slug = 'legacy-org')), 40, 'and their 40 permissions');
set local role service_role;
select throws_ok($$select private.seed_org_roles((select id from public.organizations where slug = 'legacy-org'))$$, '42501', null, 'service_role cannot call the seed');
reset role;

-- No client access
set local role anon;
select throws_ok($$select 1 from public.roles$$, '42501', null, 'anon: roles');
select throws_ok($$select 1 from public.organization_members$$, '42501', null, 'anon: members');
reset role;
set local role authenticated;
select throws_ok($$select 1 from public.permissions$$, '42501', null, 'authenticated: permissions');
select throws_ok($$select 1 from public.roles$$, '42501', null, 'authenticated: roles');
select throws_ok($$select 1 from public.role_permissions$$, '42501', null, 'authenticated: role_permissions');
select throws_ok($$insert into public.organization_members (org_id, user_id, role_id) select org_id, user_id, role_id from public.organization_members$$, '42501', null, 'authenticated: members write');
select throws_ok($$select 1 from public.location_staff$$, '42501', null, 'authenticated: location_staff');
select throws_ok($$select 1 from public.default_role_permissions$$, '42501', null, 'authenticated: default_role_permissions');
reset role;

select * from finish();
rollback;
