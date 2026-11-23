-- STAGING SEED. Applied by hand through the "Deploy DB (staging)" workflow (apply_seed), after the
-- migrations, in one transaction. See docs/STAGING.md.
--
-- It creates NO auth users, passwords, identities, platform admins, members or other tenants. It
-- only inserts and is safe to run again (every statement is a no-op the second time). Never put
-- credentials or real addresses in this file; a platform admin on staging needs the project owner's
-- approval and is added by hand (docs/STAGING.md).
--
-- Packages are PLACEHOLDERS: names, limits and features follow PROJECT.md section 6 (a proposal) and
-- every price is 0. M1 (M1-LD-01) sets the real plans.

insert into public.packages (
  key, name, description, price_monthly, price_yearly, trial_days,
  max_locations, max_staff, max_tables,
  feature_online_payments, feature_reservations, feature_customers, feature_custom_roles,
  feature_staff_schedules, feature_advanced_reports, feature_csv_export, feature_theme_customization,
  feature_custom_domain, feature_loyalty, is_public, sort_order
) values
  ('starter', 'Starter', 'Placeholder plan. Pricing is set in M1.', 0, 0, 14,
   1, 5, 20, false, false, false, false, false, false, false, false, false, false, true, 1),
  ('growth', 'Growth', 'Placeholder plan. Pricing is set in M1.', 0, 0, 14,
   3, 25, 100, true, true, true, true, true, true, true, true, false, false, true, 2),
  ('pro', 'Pro', 'Placeholder plan. Pricing is set in M1.', 0, 0, 14,
   null, null, null, true, true, true, true, true, true, true, true, true, true, true, 3)
on conflict (key) do nothing;

-- Demo Restaurant: the organization trigger seeds its five system roles on first insert.
insert into public.organizations (id, name, slug)
values ('d0000000-0000-4000-8000-000000000201', 'Demo Restaurant', 'demo')
on conflict (slug) do nothing;

-- The subscription goes in before the locations: plan limits read it.
insert into public.subscriptions (org_id, package_id, status, current_period_start)
select o.id, p.id, 'active', now()
from public.organizations o, public.packages p
where o.slug = 'demo' and p.key = 'growth'
  and not exists (select 1 from public.subscriptions s where s.org_id = o.id);

insert into public.org_branding (org_id)
select id from public.organizations where slug = 'demo'
on conflict (org_id) do nothing;

insert into public.locations (id, org_id, name, address, tax_bps, service_charge_bps, tax_on_service)
select v.id::uuid, o.id, v.name, v.address, 1000, 500, false
from (values
  ('d0000000-0000-4000-8000-000000000401', 'Demo Central', 'Jl. Contoh No. 1, Jakarta'),
  ('d0000000-0000-4000-8000-000000000402', 'Demo Harbor', 'Jl. Contoh No. 2, Jakarta')
) as v(id, name, address)
join public.organizations o on o.slug = 'demo'
where not exists (select 1 from public.locations x where x.id = v.id::uuid);
