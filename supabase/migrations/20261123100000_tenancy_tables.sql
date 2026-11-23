-- M0-BE-06: tenancy tables. organizations, reserved_slugs, locations, org_branding.
-- M0-BE-29 baseline: no privilege until granted. Until membership exists (M0-BE-08/10) clients get
-- no access at all: RLS is on, there is no policy, and anon/authenticated get no grant. Only the
-- server (service_role) reads and writes. M0-BE-08/10 add the member read policies and grants.

-- ---------------------------------------------------------------------------------------------
-- reserved_slugs
-- ---------------------------------------------------------------------------------------------
create table public.reserved_slugs (
  slug text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$'),
  created_at timestamptz not null default now()
);

alter table public.reserved_slugs enable row level security;

-- Changed by migration only.
grant select on table public.reserved_slugs to service_role;

insert into public.reserved_slugs (slug) values
  ('www'), ('app'), ('admin'), ('api'), ('auth'), ('mail'), ('email'), ('smtp'), ('ftp'),
  ('static'), ('assets'), ('cdn'), ('media'), ('img'), ('images'), ('status'), ('help'),
  ('support'), ('docs'), ('blog'), ('billing'), ('pay'), ('payments'), ('login'), ('signup'),
  ('dashboard'), ('console'), ('staging'), ('test'), ('dev'), ('demo-admin'), ('restomate'),
  ('root'), ('system'), ('platform'), ('webhook'), ('webhooks'), ('doku'), ('supabase');

-- ---------------------------------------------------------------------------------------------
-- Shared guards (private; trigger functions are never called by a client)
-- ---------------------------------------------------------------------------------------------
create function private.assert_valid_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Raises invalid_parameter_value (22023) for an unknown zone.
  perform now() at time zone new.timezone;
  return new;
end;
$$;

create function private.assert_slug_not_reserved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug) then
    raise exception 'slug is reserved' using errcode = '23514', constraint = 'organizations_slug_not_reserved';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null
    constraint organizations_slug_format check (
      char_length(slug) between 3 and 40 and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$'
    ),
  status text not null default 'active' check (status in ('active', 'suspended')),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Jakarta' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug)
);

alter table public.organizations enable row level security;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

create trigger organizations_check_timezone
  before insert or update of timezone on public.organizations
  for each row execute function private.assert_valid_timezone();

create trigger organizations_check_slug_reserved
  before insert or update of slug on public.organizations
  for each row execute function private.assert_slug_not_reserved();

-- No delete: a tenant is suspended, not removed.
grant select, insert, update on table public.organizations to service_role;

-- audit_logs.org_id (M0-BE-05). The log outlives the organization.
alter table public.audit_logs
  add constraint audit_logs_org_id_fkey
  foreign key (org_id) references public.organizations (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- locations. Rates are integer basis points, 0 to 10000 (0% to 100%).
-- ---------------------------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  address text check (address is null or char_length(address) <= 500),
  timezone text not null default 'Asia/Jakarta' check (char_length(timezone) between 1 and 64),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  tax_bps integer not null default 0 check (tax_bps between 0 and 10000),
  service_charge_bps integer not null default 0 check (service_charge_bps between 0 and 10000),
  tax_on_service boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets later tables reference a location together with its org.
  constraint locations_org_id_id_key unique (org_id, id)
);

alter table public.locations enable row level security;

create index locations_org_id_idx on public.locations (org_id);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function private.set_updated_at();

create trigger locations_check_timezone
  before insert or update of timezone on public.locations
  for each row execute function private.assert_valid_timezone();

grant select, insert, update on table public.locations to service_role;

-- ---------------------------------------------------------------------------------------------
-- org_branding
-- ---------------------------------------------------------------------------------------------
create table public.org_branding (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  logo_url text check (logo_url is null or (logo_url ~ '^https://[^\s]+$' and char_length(logo_url) <= 2048)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_branding enable row level security;

create trigger org_branding_set_updated_at
  before update on public.org_branding
  for each row execute function private.set_updated_at();

grant select, insert, update on table public.org_branding to service_role;
