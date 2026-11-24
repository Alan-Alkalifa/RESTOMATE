-- M0-QA-02: tenant isolation on every table in `public`.
--
-- Two tenants (A and B), each with a row in every tenant-scoped table. Then, for each table:
--   * anon: select, insert, update and delete are all denied, on all 18 tables
--   * a member of A: B's rows are invisible or denied, and insert, update and delete against B fail; and the reverse
--   * a user in no organization: sees none of either tenant's rows
--   * positive controls: A does see A's own rows where a select policy exists (so "sees nothing" can't pass by
--     accident), and the three tables with no member select grant stay denied
--   * profiles: another user's profile can't be read or changed
--
-- "Fails" means a 42501 (privilege or RLS) or zero affected rows. Any other outcome fails the test, including
-- an error such as a NOT NULL violation: that means a write path now exists, and it needs its own isolation
-- test with real values before this file is changed to accept it.
begin;
select plan(186);

-- ---------------------------------------------------------------------------------------------
-- Helpers (run as the invoking role, so they test what that role can do)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.attempt(q text) returns text language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception
  when insufficient_privilege then return 'denied';
  when others then return 'err:' || sqlstate;
end $$;

create function pg_temp.seen(t text, c text, v text) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from public.%I where %I::text = %L', t, c, v) into n;
  return n;
exception when insufficient_privilege then return -1;
end $$;

-- The 11 tenant-scoped tables and the column that names the tenant.
create function pg_temp.tenant_tables() returns table (t text, c text) language sql as $$
  values ('audit_logs', 'org_id'), ('location_staff', 'org_id'), ('locations', 'org_id'),
         ('org_branding', 'org_id'), ('organization_members', 'org_id'), ('organizations', 'id'),
         ('role_permissions', 'org_id'), ('roles', 'org_id'), ('staff_invitation_locations', 'org_id'),
         ('staff_invitations', 'org_id'), ('subscriptions', 'org_id')
$$;

create function pg_temp.as_user(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0')), 'role', 'authenticated')::text, true);
$$;

grant execute on function pg_temp.attempt(text), pg_temp.seen(text, text, text), pg_temp.tenant_tables() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixture, created as postgres (no auth.uid(), RLS bypassed)
-- u1 owns A, u2 owns B, u3 belongs to no organization.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'iso' || n || '@example.test'
from generate_series(1, 3) n;

insert into public.packages (key, name, max_locations, max_staff) values ('iso_test', 'Isolation test', 5, 20);
insert into public.organizations (name, slug) values ('Iso A', 'iso-a'), ('Iso B', 'iso-b');
select set_config('qa.a', (select id::text from public.organizations where slug = 'iso-a'), true);
select set_config('qa.b', (select id::text from public.organizations where slug = 'iso-b'), true);

insert into public.subscriptions (org_id, package_id, status)
select o.id, p.id, 'active' from public.organizations o, public.packages p where o.slug in ('iso-a', 'iso-b') and p.key = 'iso_test';
insert into public.org_branding (org_id) select id from public.organizations where slug in ('iso-a', 'iso-b') on conflict do nothing;
insert into public.locations (org_id, name) select id, 'Main' from public.organizations where slug in ('iso-a', 'iso-b');

insert into public.organization_members (org_id, user_id, role_id)
select o.id, u.id, r.id
from (values ('iso-a', '00000000-0000-0000-0000-000000000001'::uuid), ('iso-b', '00000000-0000-0000-0000-000000000002'::uuid)) u2(slug, id)
join public.organizations o on o.slug = u2.slug
join auth.users u on u.id = u2.id
join public.roles r on r.org_id = o.id and r.system_key = 'owner';

insert into public.location_staff (member_id, location_id, org_id)
select m.id, l.id, m.org_id from public.organization_members m join public.locations l on l.org_id = m.org_id
where m.org_id in (select id from public.organizations where slug in ('iso-a', 'iso-b'));

insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
select o.id, 'invitee-' || o.slug || '@example.test', r.id, sha256(convert_to(o.slug, 'UTF8')), now() + interval '2 days'
from public.organizations o join public.roles r on r.org_id = o.id and r.system_key = 'cashier'
where o.slug in ('iso-a', 'iso-b');
insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
select i.id, l.id, i.org_id from public.staff_invitations i join public.locations l on l.org_id = i.org_id
where i.org_id in (select id from public.organizations where slug in ('iso-a', 'iso-b'));

insert into public.audit_logs (org_id, action)
select id, 'iso.test' from public.organizations where slug in ('iso-a', 'iso-b');

-- Fixture sanity: both tenants have a row in each tenant table (a missing row would hide a leak).
select is(
  (select count(*)::int from pg_temp.tenant_tables() tt
   where pg_temp.seen(tt.t, tt.c, current_setting('qa.a')) > 0 and pg_temp.seen(tt.t, tt.c, current_setting('qa.b')) > 0),
  11,
  'fixture: tenants A and B each have rows in all 11 tenant tables'
);

-- ---------------------------------------------------------------------------------------------
-- 1. anon: nothing, anywhere (72 = 18 tables x 4 operations)
-- ---------------------------------------------------------------------------------------------
set local role anon;

select ok(pg_temp.attempt(format('select count(*) from public.%I', c.relname)) = 'denied', format('anon cannot select from %s', c.relname))
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname;

select ok(pg_temp.attempt(format('insert into public.%I default values', c.relname)) = 'denied', format('anon cannot insert into %s', c.relname))
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname;

select ok(pg_temp.attempt(format('update public.%I set %I = %I', c.relname, a.attname, a.attname)) = 'denied', format('anon cannot update %s', c.relname))
from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum = 1
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname;

select ok(pg_temp.attempt(format('delete from public.%I', c.relname)) = 'denied', format('anon cannot delete from %s', c.relname))
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname;

reset role;

-- ---------------------------------------------------------------------------------------------
-- 2. A member of A against B, and a member of B against A (88 = 11 tables x 4 operations x 2 directions)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(1);
set local role authenticated;

select ok(pg_temp.seen(t, c, current_setting('qa.b')) <= 0, format('A cannot read B rows in %s', t)) from pg_temp.tenant_tables() order by t;
select ok(pg_temp.attempt(format('insert into public.%I (%I) values (%L)', t, c, current_setting('qa.b'))) in ('denied', 'rows:0'), format('A cannot insert a B row into %s', t)) from pg_temp.tenant_tables() order by t;
select ok(pg_temp.attempt(format('update public.%I set %I = %I where %I::text = %L', t, c, c, c, current_setting('qa.b'))) in ('denied', 'rows:0'), format('A cannot update B rows in %s', t)) from pg_temp.tenant_tables() order by t;
select ok(pg_temp.attempt(format('delete from public.%I where %I::text = %L', t, c, current_setting('qa.b'))) in ('denied', 'rows:0'), format('A cannot delete B rows in %s', t)) from pg_temp.tenant_tables() order by t;

-- 3. Positive controls, still as A: own rows are visible where a member select policy exists.
select ok(pg_temp.seen(t, c, current_setting('qa.a')) > 0, format('control: A sees its own rows in %s', t))
from pg_temp.tenant_tables() where t not in ('staff_invitation_locations', 'staff_invitations', 'subscriptions') order by t;
select is(pg_temp.seen(t, c, current_setting('qa.a')), -1, format('control: members have no select grant on %s', t))
from pg_temp.tenant_tables() where t in ('staff_invitation_locations', 'staff_invitations', 'subscriptions') order by t;

reset role;
select pg_temp.as_user(2);
set local role authenticated;

select ok(pg_temp.seen(t, c, current_setting('qa.a')) <= 0, format('B cannot read A rows in %s', t)) from pg_temp.tenant_tables() order by t;
select ok(pg_temp.attempt(format('insert into public.%I (%I) values (%L)', t, c, current_setting('qa.a'))) in ('denied', 'rows:0'), format('B cannot insert an A row into %s', t)) from pg_temp.tenant_tables() order by t;
select ok(pg_temp.attempt(format('update public.%I set %I = %I where %I::text = %L', t, c, c, c, current_setting('qa.a'))) in ('denied', 'rows:0'), format('B cannot update A rows in %s', t)) from pg_temp.tenant_tables() order by t;
select ok(pg_temp.attempt(format('delete from public.%I where %I::text = %L', t, c, current_setting('qa.a'))) in ('denied', 'rows:0'), format('B cannot delete A rows in %s', t)) from pg_temp.tenant_tables() order by t;

-- profiles: A's and B's owners can't read or change each other's profile (u2 is signed in here).
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 0, 'B owner cannot read A owner''s profile');
select is(pg_temp.attempt($q$update public.profiles set full_name = 'hijacked' where id = '00000000-0000-0000-0000-000000000001'$q$) in ('denied', 'rows:0'), true, 'B owner cannot update A owner''s profile');

reset role;

-- ---------------------------------------------------------------------------------------------
-- 4. A signed-in user who belongs to no organization sees neither tenant (11)
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user(3);
set local role authenticated;

select ok(pg_temp.seen(t, c, current_setting('qa.a')) <= 0 and pg_temp.seen(t, c, current_setting('qa.b')) <= 0, format('an outsider sees no rows of either tenant in %s', t))
from pg_temp.tenant_tables() order by t;

select is((select count(*)::int from public.profiles where id <> '00000000-0000-0000-0000-000000000003'), 0, 'an outsider cannot read other profiles');
reset role;

select * from finish();
rollback;
