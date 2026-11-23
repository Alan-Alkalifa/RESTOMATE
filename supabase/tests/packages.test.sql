-- M0-BE-07: packages, subscriptions, default trial, no client access, canonical timezones.
begin;
select plan(47);

select has_table('public'::name, t::name) from unnest(array['packages','subscriptions']) t;
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.packages'::regclass,'public.subscriptions'::regclass)), 'RLS on');

-- Seed: exactly one default, a placeholder at price 0
select is((select count(*)::int from public.packages where is_default), 1, 'one default package seeded');
select is((select price_monthly + price_yearly from public.packages where is_default), 0, 'default package is free');
select is((select count(*)::int from public.packages where price_monthly > 0 or price_yearly > 0), 0, 'no invented prices');

-- Only one default
select throws_ok($$insert into public.packages (key, name, is_default) values ('second', 'Second', true)$$, '23505', null, 'second default refused');
select lives_ok($$insert into public.packages (key, name, price_monthly, trial_days, max_locations) values ('plan_a', 'A', 100000, 7, null)$$, 'non-default package ok');
select throws_ok($$update public.packages set is_active = false where is_default$$, '23514', null, 'default cannot be archived');
select throws_ok($$insert into public.packages (key, name) values ('trial', 'Dup')$$, '23505', null, 'key unique');
select throws_ok($$insert into public.packages (key, name, price_monthly) values ('neg', 'N', -1)$$, '23514', null, 'negative price refused');
select throws_ok($$insert into public.packages (key, name, trial_days) values ('trial2', 'N', 366)$$, '23514', null, 'trial days capped');
select throws_ok($$insert into public.packages (key, name, max_staff) values ('lim', 'N', -1)$$, '23514', null, 'negative limit refused');
select throws_ok($$insert into public.packages (key, name, currency) values ('cur', 'N', 'idr')$$, '23514', null, 'currency format');
select throws_ok($$insert into public.packages (key, name) values ('Bad Key', 'N')$$, '23514', null, 'key format');
select lives_ok($$update public.packages set is_active = false where key = 'plan_a'$$, 'non-default can be archived');

-- Default package gives a new restaurant a trial
insert into public.organizations (name, slug) values ('Trial Co', 'trial-co');
select lives_ok($$select private.start_default_trial((select id from public.organizations where slug = 'trial-co'))$$, 'start trial');
select is((select status from public.subscriptions), 'trialing', 'status is trialing');
select is((select trial_ends_at from public.subscriptions), (select current_period_start + interval '14 days' from public.subscriptions), 'trial_ends_at = now + trial days');
select is((select package_id from public.subscriptions), (select id from public.packages where is_default), 'on the default package');
select throws_ok($$select private.start_default_trial((select id from public.organizations where slug = 'trial-co'))$$, '23505', null, 'second current subscription refused');
select throws_ok($$select private.start_default_trial(gen_random_uuid())$$, '23503', null, 'organization must exist');

-- Subscription constraints
select throws_ok($$update public.subscriptions set status = 'paused'$$, '23514', null, 'status check');
select throws_ok($$update public.subscriptions set trial_ends_at = null$$, '23514', null, 'trialing needs trial_ends_at');
select throws_ok($$update public.subscriptions set current_period_end = current_period_start - interval '1 day'$$, '23514', null, 'period order');
select throws_ok($$update public.subscriptions set status = 'canceled'$$, '23514', null, 'canceled needs canceled_at');
select lives_ok($$update public.subscriptions set status = 'canceled', canceled_at = now()$$, 'cancel');
select lives_ok($$select private.start_default_trial((select id from public.organizations where slug = 'trial-co'))$$, 'a new current one after cancel (history kept)');
select is((select count(*)::int from public.subscriptions), 2, 'history kept');
select throws_ok($$delete from public.packages where is_default$$, '23503', null, 'package in use cannot be deleted');

-- No client access
set local role anon;
select throws_ok($$select 1 from public.packages$$, '42501', null, 'anon: packages');
select throws_ok($$select 1 from public.subscriptions$$, '42501', null, 'anon: subscriptions');
reset role;
set local role authenticated;
select throws_ok($$select 1 from public.packages$$, '42501', null, 'authenticated: packages');
select throws_ok($$update public.packages set price_monthly = 0$$, '42501', null, 'authenticated: write packages');
select throws_ok($$select 1 from public.subscriptions$$, '42501', null, 'authenticated: subscriptions');
select throws_ok($$select private.start_default_trial(gen_random_uuid())$$, '42501', null, 'authenticated cannot start trials');
reset role;

-- Canonical timezones (S3)
select throws_ok(format($$insert into public.organizations (name, slug, timezone) values ('x', %L, %L)$$, 'tz-' || n, tz), '22023', null, tz || ' refused')
from (values (1,'posix/Asia/Jakarta'),(2,'right/Asia/Jakarta'),(3,'SystemV/AST4'),(4,'US/Pacific'),(5,'Etc/GMT-7'),(6,'EST'),(7,'UTC+7')) v(n, tz);
select lives_ok(format($$insert into public.organizations (name, slug, timezone) values ('x', %L, %L)$$, 'ok-' || n, tz), tz || ' accepted')
from (values (1,'Asia/Jakarta'),(2,'Asia/Makassar'),(3,'UTC'),(4,'America/Argentina/Buenos_Aires')) v(n, tz);

select * from finish();
rollback;
