-- M0-BE-05: identity tables. profiles, platform_admins, platform_settings, audit_logs.
-- The M0-BE-29 baseline applies: each table starts with no privilege, so every grant is below,
-- next to the table's RLS policies. RLS is on for every table.

create schema if not exists private;

-- Never exposed through the Data API (config.toml exposes only `public`). Only postgres and the
-- definer functions below use it; API roles get usage in the migrations that add policy helpers.

-- Shared updated_at trigger function (M0-BE-11 reuses it).
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- profiles: one row per auth user, kept in sync by triggers on auth.users.
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  locale text not null default 'en' check (locale in ('en', 'id')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- A user reads and edits only their own row. email and id are not client-writable.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on table public.profiles to authenticated;
grant update (full_name, avatar_url, locale) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- Sync from auth.users. The trigger runs as the function owner; it is never called by a client.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    new.email,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), ''),
    case when new.raw_user_meta_data ->> 'locale' = 'id' then 'id' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Users that exist before this migration (hosted staging).
insert into public.profiles (id, email, full_name, locale)
select
  u.id,
  u.email,
  nullif(left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 120), ''),
  case when u.raw_user_meta_data ->> 'locale' = 'id' then 'id' else 'en' end
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- platform_admins: service role only. No policy and no grant for anon or authenticated.
-- Rows are inserted by hand with the project owner's approval (docs/STAGING.md).
-- ---------------------------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function private.set_updated_at();

-- requirePlatformAdmin reads it with the service role. Insert and delete stay manual.
grant select on table public.platform_admins to service_role;

-- ---------------------------------------------------------------------------------------------
-- platform_settings: deny by default. Key/value, written by the server with the service role.
-- ---------------------------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  value jsonb not null,
  description text,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function private.set_updated_at();

create index platform_settings_updated_by_idx on public.platform_settings (updated_by);

grant select, insert, update on table public.platform_settings to service_role;

-- ---------------------------------------------------------------------------------------------
-- audit_logs: append-only. No client access; the server writes with the service role.
-- org_id has no foreign key yet: organizations arrive in M0-BE-06, which adds it and the
-- org-scoped read policy. Keep personal data out of metadata.
-- ---------------------------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  entity_type text check (entity_type is null or char_length(entity_type) <= 100),
  entity_id text check (entity_id is null or char_length(entity_id) <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

create index audit_logs_org_created_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

-- No update or delete grant: rows can't change through the API, even for the service role.
grant select, insert on table public.audit_logs to service_role;
