-- M0-BE-07: packages and subscriptions.
-- M0-BE-29 baseline: no privilege until granted. Until membership exists (M0-BE-08/10) clients get
-- no access: RLS is on, there is no policy, and anon/authenticated get no grant. Only the server
-- (service_role) reads and writes. M0-BE-10 adds the member reads (get_org_package) and M1-BE-01
-- the public pricing read.

-- ---------------------------------------------------------------------------------------------
-- packages. Prices are integer IDR (exponent 0). Limits are typed columns (null = unlimited).
-- Features are typed boolean columns, so no free-form shape can reach the table.
-- Archive a package with is_active = false; subscriptions keep pointing at it.
-- ---------------------------------------------------------------------------------------------
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  price_monthly integer not null default 0 check (price_monthly >= 0),
  price_yearly integer not null default 0 check (price_yearly >= 0),
  trial_days integer not null default 0 check (trial_days between 0 and 365),

  max_locations integer check (max_locations is null or max_locations >= 0),
  max_staff integer check (max_staff is null or max_staff >= 0),
  max_tables integer check (max_tables is null or max_tables >= 0),

  feature_online_payments boolean not null default false,
  feature_reservations boolean not null default false,
  feature_customers boolean not null default false,
  feature_custom_roles boolean not null default false,
  feature_staff_schedules boolean not null default false,
  feature_advanced_reports boolean not null default false,
  feature_csv_export boolean not null default false,
  feature_theme_customization boolean not null default false,
  feature_custom_domain boolean not null default false,
  feature_loyalty boolean not null default false,

  is_active boolean not null default true,
  is_public boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint packages_key_key unique (key),
  -- The default package starts every trial, so it can't be archived.
  constraint packages_default_is_active check (not is_default or is_active)
);

alter table public.packages enable row level security;

-- Exactly one default package.
create unique index packages_one_default_idx on public.packages ((true)) where is_default;

create trigger packages_set_updated_at
  before update on public.packages
  for each row execute function private.set_updated_at();

-- No delete: archive instead.
grant select, insert, update on table public.packages to service_role;

-- Placeholder default trial package. Pricing is the project owner's decision (M1-LD-01): M1 sets
-- the real plans, prices and limits. Nothing here is a price, a plan name or a final limit.
-- Limits borrow the "Starter" column of PROJECT.md section 6 and no feature is on.
insert into public.packages (key, name, description, trial_days, max_locations, max_staff, max_tables, is_public, is_default)
values ('trial', 'Trial', 'Placeholder default package. M1 sets the real plans.', 14, 1, 5, 20, false, true);

-- ---------------------------------------------------------------------------------------------
-- subscriptions. Many rows per organization over time, one current one.
-- ---------------------------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  package_id uuid not null references public.packages (id) on delete restrict,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null),
  constraint subscriptions_period_order check (current_period_end is null or current_period_end >= current_period_start),
  constraint subscriptions_canceled_has_time check (status <> 'canceled' or canceled_at is not null)
);

alter table public.subscriptions enable row level security;

-- One current subscription per organization; canceled rows are history.
create unique index subscriptions_one_current_idx
  on public.subscriptions (org_id) where status in ('trialing', 'active', 'past_due');
create index subscriptions_package_id_idx on public.subscriptions (package_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function private.set_updated_at();

grant select, insert, update on table public.subscriptions to service_role;

-- Starts the trial for a new organization from the default package. M0-BE-12 create_organization
-- calls it in the same transaction. trial_ends_at is now() + the package's trial days. No client
-- can call it: the private schema is not exposed and no role is granted execute.
create function private.start_default_trial(p_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package public.packages;
  v_id uuid;
begin
  select * into v_package from public.packages where is_default;
  if not found then
    raise exception 'no default package' using errcode = 'P0002';
  end if;

  insert into public.subscriptions (org_id, package_id, status, trial_ends_at, current_period_start, current_period_end)
  values (
    p_org_id,
    v_package.id,
    'trialing',
    now() + make_interval(days => v_package.trial_days),
    now(),
    now() + make_interval(days => v_package.trial_days)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- S3 (from M0-BE-06 QA): canonical IANA timezones only. Replaces the function from the tenancy
-- migration (create or replace; the triggers already point at it). The list of areas refuses the
-- 'posix/' and 'right/' mirrors, 'SystemV/', 'Etc/' and the legacy alias folders ('US/', 'Canada/',
-- ...), and abbreviations or POSIX strings. 'Asia/Jakarta', 'Asia/Makassar' and 'UTC' stay valid.
-- Rows written before this change are not re-checked until their timezone is written again.
-- ---------------------------------------------------------------------------------------------
create or replace function private.assert_valid_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names z
    where z.name = new.timezone
      and (
        z.name = 'UTC'
        or z.name ~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z0-9_+/-]+$'
      )
  ) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;
