-- M0-BE-06: tenancy constraints, and no client access until membership exists.
begin;
select plan(52);

select has_table('public'::name, t::name) from unnest(array['organizations','reserved_slugs','locations','org_branding']) t;
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.organizations'::regclass,'public.reserved_slugs'::regclass,'public.locations'::regclass,'public.org_branding'::regclass)), 'RLS on every tenancy table');

-- Slug format, length, uniqueness
insert into public.organizations (name, slug) values ('Demo', 'demo-resto');

-- Fixture: plan limits are enforced by the M0-BE-11 guards, so test orgs get an unlimited package.
insert into public.packages (key, name) values ('test_unlimited', 'Unlimited (test)');
insert into public.subscriptions (org_id, package_id, status)
select o.id, (select id from public.packages where key = 'test_unlimited'), 'active' from public.organizations o where o.slug in ('demo-resto');
select is((select currency || timezone || status from public.organizations where slug = 'demo-resto'), 'IDRAsia/Jakartaactive', 'defaults');
select throws_ok($$insert into public.organizations (name, slug) values ('x','ab')$$, '23514', null, 'slug too short');
select lives_ok($$insert into public.organizations (name, slug) values ('x','abc')$$, '3 chars ok');
select lives_ok($$insert into public.organizations (name, slug) values ('x', repeat('a',40))$$, '40 chars ok');
select throws_ok($$insert into public.organizations (name, slug) values ('x', repeat('a',41))$$, '23514', null, 'slug too long');
select throws_ok($$insert into public.organizations (name, slug) values ('x','Demo-Two')$$, '23514', null, 'uppercase refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','-demo')$$, '23514', null, 'leading hyphen refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','demo-')$$, '23514', null, 'trailing hyphen refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','de mo')$$, '23514', null, 'space refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','de_mo')$$, '23514', null, 'underscore refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','demo-resto')$$, '23505', null, 'duplicate slug refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','www')$$, '23514', null, 'reserved slug refused on insert');
select throws_ok($$update public.organizations set slug = 'admin' where slug = 'demo-resto'$$, '23514', null, 'reserved slug refused on update');
select throws_ok($$insert into public.organizations (name, slug, status) values ('x','abcd','gone')$$, '23514', null, 'status check');
select throws_ok($$insert into public.organizations (name, slug, currency) values ('x','abce','idr')$$, '23514', null, 'currency check');
select throws_ok($$insert into public.organizations (name, slug, timezone) values ('x','abcf','Mars/Base')$$, '22023', null, 'unknown timezone refused');

select throws_ok($$insert into public.organizations (name, slug) values ('x','xn--abc')$$, '23514', null, 'punycode slug refused');
select throws_ok($$insert into public.organizations (name, slug) values ('x','a--b')$$, '23514', null, 'double hyphen refused');
select throws_ok($$insert into public.reserved_slugs (slug) values ('x--y')$$, '23514', null, 'reserved_slugs refuses double hyphen');
select throws_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-one','UTC+7')$$, '22023', null, 'POSIX UTC+7 refused');
select throws_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-two','EST')$$, '22023', null, 'abbreviation EST refused');
select throws_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-three','Etc/GMT-7')$$, '22023', null, 'Etc/GMT-7 refused');
select throws_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-four','EST5EDT')$$, '22023', null, 'EST5EDT refused');
select lives_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-five','Asia/Jakarta')$$, 'Asia/Jakarta accepted');
select lives_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-six','Asia/Makassar')$$, 'Asia/Makassar accepted');
select lives_ok($$insert into public.organizations (name, slug, timezone) values ('x','tz-seven','UTC')$$, 'UTC accepted');

-- Locations
insert into public.locations (org_id, name) select id, 'Main' from public.organizations where slug = 'demo-resto';
select is((select l.tax_bps from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'demo-resto'), 0, 'location tax defaults to 0');
select lives_ok($$update public.locations set tax_bps = 10000, service_charge_bps = 10000$$, '100% is the upper bound');
select throws_ok($$update public.locations set tax_bps = 10001$$, '23514', null, 'tax over 10000 bps');
select throws_ok($$update public.locations set tax_bps = -1$$, '23514', null, 'negative tax');
select throws_ok($$update public.locations set service_charge_bps = 10001$$, '23514', null, 'service charge over 10000 bps');
select throws_ok($$update public.locations set service_charge_bps = -1$$, '23514', null, 'negative service charge');
select throws_ok($$update public.locations set timezone = 'UTC+7'$$, '22023', null, 'location refuses UTC+7');
select throws_ok($$update public.locations set timezone = 'Nowhere/Land'$$, '22023', null, 'location timezone checked');
select throws_ok($$insert into public.locations (org_id, name) values (gen_random_uuid(), 'Orphan')$$, 'P0001', 'PLAN_LIMIT:locations', 'an unknown org has no subscription, so no location (the guard fires before the foreign key)');

-- Branding: https only
insert into public.org_branding (org_id) select id from public.organizations where slug = 'demo-resto';
select lives_ok($$update public.org_branding set logo_url = 'https://cdn.example.test/logo.png'$$, 'https logo ok');
select throws_ok($$update public.org_branding set logo_url = 'http://cdn.example.test/logo.png'$$, '23514', null, 'http logo refused');
select throws_ok($$update public.org_branding set logo_url = 'javascript:alert(1)'$$, '23514', null, 'javascript url refused');
select throws_ok($$update public.org_branding set logo_url = 'data:image/png;base64,AAAA'$$, '23514', null, 'data url refused');

-- audit_logs.org_id now references organizations
select lives_ok($$insert into public.audit_logs (org_id, action) select id, 'seed' from public.organizations where slug = 'demo-resto'$$, 'audit row with an org');
select throws_ok($$insert into public.audit_logs (org_id, action) values (gen_random_uuid(), 'x')$$, '23503', null, 'audit org must exist');

-- Clients get nothing yet
set local role anon;
select throws_ok($$select 1 from public.organizations$$, '42501', null, 'anon: organizations');
select throws_ok($$select 1 from public.locations$$, '42501', null, 'anon: locations');
reset role;
set local role authenticated;
select is((select count(*)::int from public.organizations), 0, 'authenticated without membership sees no organizations rows (read policy, M0-BE-10)');
select throws_ok($$select 1 from public.reserved_slugs$$, '42501', null, 'authenticated: reserved_slugs');
select throws_ok($$insert into public.locations (org_id, name) select id, 'x' from public.organizations$$, '42501', null, 'authenticated: locations write');
select is((select count(*)::int from public.org_branding), 0, 'authenticated without membership sees no org_branding rows (read policy, M0-BE-10)');
reset role;

select * from finish();
rollback;
