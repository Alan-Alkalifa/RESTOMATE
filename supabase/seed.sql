-- LOCAL DEVELOPMENT SEED. Applied by `supabase db reset` (config.toml [db.seed]) and never anywhere else.
-- It is never used on staging or production: it creates users with a shared password and a platform
-- admin. supabase/seed-staging.sql is the staging seed and has no users.
--
-- Every user signs in with the shared LOCAL-ONLY password:  restomate-local-only
-- (hash below is bcrypt of that password). All addresses use the reserved example.test domain; none
-- is a real mailbox. Mail sent to them lands in Mailpit.
--
--   admin@restomate.example.test    platform admin (no organization)
--   owner@demo.example.test         Owner     of Demo Restaurant
--   manager@demo.example.test       Manager   of Demo Restaurant
--   cashier@demo.example.test       Cashier   of Demo Restaurant (both locations)
--   waiter@demo.example.test        Waiter    of Demo Restaurant (Demo Central only)
--   kitchen@demo.example.test       Kitchen   of Demo Restaurant (Demo Central only)
--   owner@second.example.test       Owner     of Kopi Kedua, a second tenant for isolation checks
--
-- Packages are PLACEHOLDERS: the names, limits and features follow the proposal in PROJECT.md
-- section 6, and every price is 0. M1 (M1-LD-01) sets the real plans.
-- Re-running the file changes nothing (the plan-limit triggers fire before ON CONFLICT, so inserts that
-- are guarded by limits use NOT EXISTS). The data is the same after every reset: ids are fixed. Only the generated ids of the five system
-- roles per organization (created by a trigger) and timestamps change.

-- ---------------------------------------------------------------------------------------------
-- Packages (the migration already created the default 'trial' package)
-- ---------------------------------------------------------------------------------------------
insert into public.packages (
  id, key, name, description, price_monthly, price_yearly, trial_days,
  max_locations, max_staff, max_tables,
  feature_online_payments, feature_reservations, feature_customers, feature_custom_roles,
  feature_staff_schedules, feature_advanced_reports, feature_csv_export, feature_theme_customization,
  feature_custom_domain, feature_loyalty, is_public, sort_order
) values
  ('d0000000-0000-4000-8000-000000000011', 'starter', 'Starter', 'Placeholder plan. Pricing is set in M1.', 0, 0, 14,
   1, 5, 20, false, false, false, false, false, false, false, false, false, false, true, 1),
  ('d0000000-0000-4000-8000-000000000012', 'growth', 'Growth', 'Placeholder plan. Pricing is set in M1.', 0, 0, 14,
   3, 25, 100, true, true, true, true, true, true, true, true, false, false, true, 2),
  ('d0000000-0000-4000-8000-000000000013', 'pro', 'Pro', 'Placeholder plan. Pricing is set in M1.', 0, 0, 14,
   null, null, null, true, true, true, true, true, true, true, true, true, true, true, 3)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Users (auth) with email identities. The profile rows come from the auth.users trigger.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
  '$2a$10$0reAX2P6slV6fp2FCowoXOqASTuk98E1e.5Hpe8JGJHeslJhS1ZKm', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name, 'locale', 'en'),
  now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000101', 'admin@restomate.example.test', 'Platform Admin'),
  ('d0000000-0000-4000-8000-000000000102', 'owner@demo.example.test', 'Demo Owner'),
  ('d0000000-0000-4000-8000-000000000103', 'manager@demo.example.test', 'Demo Manager'),
  ('d0000000-0000-4000-8000-000000000104', 'cashier@demo.example.test', 'Demo Cashier'),
  ('d0000000-0000-4000-8000-000000000105', 'waiter@demo.example.test', 'Demo Waiter'),
  ('d0000000-0000-4000-8000-000000000106', 'kitchen@demo.example.test', 'Demo Kitchen'),
  ('d0000000-0000-4000-8000-000000000107', 'owner@second.example.test', 'Second Owner')
) as u(id, email, full_name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
from auth.users u
where u.email like '%.example.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

insert into public.platform_admins (user_id)
values ('d0000000-0000-4000-8000-000000000101')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Organizations. The subscription goes in before locations and members: plan limits read it.
-- Demo Restaurant is on Growth (room for two locations and five staff), Kopi Kedua on Starter.
-- ---------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('d0000000-0000-4000-8000-000000000201', 'Demo Restaurant', 'demo'),
  ('d0000000-0000-4000-8000-000000000202', 'Kopi Kedua', 'kopi-kedua')
on conflict (slug) do nothing;

insert into public.subscriptions (id, org_id, package_id, status, trial_ends_at, current_period_start, current_period_end)
select 'd0000000-0000-4000-8000-000000000301'::uuid, o.id, p.id, 'active', null, now(), null
from public.organizations o, public.packages p where o.slug = 'demo' and p.key = 'growth'
on conflict (id) do nothing;
insert into public.subscriptions (id, org_id, package_id, status, trial_ends_at, current_period_start, current_period_end)
select 'd0000000-0000-4000-8000-000000000302'::uuid, o.id, p.id, 'active', null, now(), null
from public.organizations o, public.packages p where o.slug = 'kopi-kedua' and p.key = 'starter'
on conflict (id) do nothing;

insert into public.org_branding (org_id)
select id from public.organizations where slug in ('demo', 'kopi-kedua')
on conflict (org_id) do nothing;

-- Tax 10% (PB1) and service charge 5% in basis points; tax is not charged on the service charge.
insert into public.locations (id, org_id, name, address, tax_bps, service_charge_bps, tax_on_service)
select v.id::uuid, o.id, v.name, v.address, v.tax_bps, v.service_bps, false
from (values
  ('d0000000-0000-4000-8000-000000000401', 'demo', 'Demo Central', 'Jl. Contoh No. 1, Jakarta', 1000, 500),
  ('d0000000-0000-4000-8000-000000000402', 'demo', 'Demo Harbor', 'Jl. Contoh No. 2, Jakarta', 1000, 500),
  ('d0000000-0000-4000-8000-000000000403', 'kopi-kedua', 'Kopi Kedua Main', 'Jl. Contoh No. 3, Bandung', 1000, 0)
) as v(id, slug, name, address, tax_bps, service_bps)
join public.organizations o on o.slug = v.slug
where not exists (select 1 from public.locations x where x.id = v.id::uuid);

-- ---------------------------------------------------------------------------------------------
-- Members (the system roles exist: the organization trigger seeded them)
-- ---------------------------------------------------------------------------------------------
insert into public.organization_members (id, org_id, user_id, role_id)
select v.id::uuid, o.id, v.user_id::uuid, r.id
from (values
  ('d0000000-0000-4000-8000-000000000501', 'demo', 'd0000000-0000-4000-8000-000000000102', 'owner'),
  ('d0000000-0000-4000-8000-000000000502', 'demo', 'd0000000-0000-4000-8000-000000000103', 'manager'),
  ('d0000000-0000-4000-8000-000000000503', 'demo', 'd0000000-0000-4000-8000-000000000104', 'cashier'),
  ('d0000000-0000-4000-8000-000000000504', 'demo', 'd0000000-0000-4000-8000-000000000105', 'waiter'),
  ('d0000000-0000-4000-8000-000000000505', 'demo', 'd0000000-0000-4000-8000-000000000106', 'kitchen'),
  ('d0000000-0000-4000-8000-000000000506', 'kopi-kedua', 'd0000000-0000-4000-8000-000000000107', 'owner')
) as v(id, slug, user_id, role_key)
join public.organizations o on o.slug = v.slug
join public.roles r on r.org_id = o.id and r.system_key = v.role_key
where not exists (select 1 from public.organization_members x where x.id = v.id::uuid);

-- Cashier works at both locations; waiter and kitchen at Demo Central only. Owner and Manager reach
-- every location without rows.
insert into public.location_staff (member_id, location_id, org_id)
select m.id, l.id, m.org_id
from public.organization_members m
join public.locations l on l.org_id = m.org_id
where m.id = 'd0000000-0000-4000-8000-000000000503'
   or (m.id in ('d0000000-0000-4000-8000-000000000504', 'd0000000-0000-4000-8000-000000000505')
       and l.id = 'd0000000-0000-4000-8000-000000000401')
on conflict do nothing;
