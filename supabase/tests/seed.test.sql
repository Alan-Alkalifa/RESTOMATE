-- M0-BE-13: the local seed (supabase/seed.sql, applied by `supabase db reset`). Staging seed has its
-- own check (apps/web/scripts/check-staging-seed.sh).
begin;
select plan(23);

select is((select count(*)::int from public.packages where key in ('starter', 'growth', 'pro')), 3, 'three placeholder packages');
select is((select count(*)::int from public.packages where key in ('starter', 'growth', 'pro') and price_monthly = 0 and price_yearly = 0), 3, 'with placeholder prices of 0');
select is((select count(*)::int from public.packages where is_default), 1, 'the default trial package is still the only default');

select is((select count(*)::int from public.organizations where slug in ('demo', 'kopi-kedua')), 2, 'Demo Restaurant and a second tenant');
select is((select name from public.organizations where slug = 'demo'), 'Demo Restaurant', 'Demo Restaurant');
select is((select count(*)::int from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'demo'), 2, 'Demo Restaurant has two locations');
select is((select count(*)::int from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'kopi-kedua'), 1, 'the second tenant has its own location');
select is((select p.key from public.subscriptions s join public.packages p on p.id = s.package_id join public.organizations o on o.id = s.org_id where o.slug = 'demo' and s.status = 'active'), 'growth', 'Demo is on Growth');

select is((select count(*)::int from auth.users where email like '%@restomate.example.test' or email like '%@demo.example.test' or email like '%@second.example.test'), 7, 'seven local users');
select is((select count(*)::int from auth.users where email like '%.example.test' and encrypted_password like '$2a$%'), 7, 'with a bcrypt password');
select is((select count(*)::int from auth.identities i join auth.users u on u.id = i.user_id where u.email like '%.example.test' and i.provider = 'email'), 7, 'and an email identity each');
select is((select count(*)::int from auth.users where email like '%.example.test' and email_confirmed_at is null), 0, 'all confirmed');
select is((select count(*)::int from auth.users where email like '%.example.test'), (select count(*)::int from public.profiles p join auth.users u on u.id = p.id where u.email like '%.example.test'), 'profiles were created by the trigger');

select is((select array_agg(r.system_key order by r.system_key) from public.organization_members m join public.roles r on r.id = m.role_id join public.organizations o on o.id = m.org_id where o.slug = 'demo'), array['cashier', 'kitchen', 'manager', 'owner', 'waiter'], 'one user per system role in Demo');
select is((select count(*)::int from public.organization_members m join public.organizations o on o.id = m.org_id where o.slug = 'kopi-kedua'), 1, 'the second tenant has its Owner');
select is((select u.email from public.organization_members m join auth.users u on u.id = m.user_id join public.roles r on r.id = m.role_id where r.system_key = 'owner' and m.org_id = (select id from public.organizations where slug = 'demo')), 'owner@demo.example.test', 'the Demo Owner');

select is((select count(*)::int from public.platform_admins), 1, 'one platform admin');
select is((select u.email from public.platform_admins a join auth.users u on u.id = a.user_id), 'admin@restomate.example.test', 'the local admin');

select is((select count(*)::int from public.location_staff s join public.organization_members m on m.id = s.member_id join public.roles r on r.id = m.role_id where r.system_key = 'waiter'), 1, 'the waiter works at one location');
select is((select count(*)::int from public.location_staff s join public.organization_members m on m.id = s.member_id join public.roles r on r.id = m.role_id where r.system_key = 'cashier'), 2, 'the cashier at both');
select is(private.org_limit((select id from public.organizations where slug = 'demo'), 'locations'), 3, 'plan limits read the seeded subscription');

-- The seed keeps every rule: nothing in it bypasses a guard.
select is((select count(*)::int from auth.users where email like '%.example.test' and email !~ '@(restomate|demo|second)\.example\.test$'), 0, 'no address outside the example.test seed domains');
select is((select count(*)::int from public.organization_members m where not exists (select 1 from auth.users u where u.id = m.user_id and u.email like '%.example.test')), 0, 'every seeded member is a seeded user');

select * from finish();
rollback;
