-- M0-BE-08: permissions, default_role_permissions, roles, role_permissions, organization_members,
-- location_staff. Seeded from the PLAN section 4.2.1 catalog.
-- M0-BE-29 baseline: no privilege until granted. Member read policies need the private helpers of
-- M0-BE-10, so for now RLS is on with no policy and anon/authenticated get no grant. Only the
-- server (service_role) reads and writes.

-- ---------------------------------------------------------------------------------------------
-- permissions: the catalog.
-- ---------------------------------------------------------------------------------------------
create table public.permissions (
  key text primary key check (key ~ '^[a-z]+\.[a-z]+$'),
  created_at timestamptz not null default now()
);

alter table public.permissions enable row level security;
grant select on table public.permissions to service_role;

insert into public.permissions (key) values
  ('menu.manage'), ('orders.view'), ('orders.create'), ('orders.void'), ('pos.use'), ('pos.discount'),
  ('kitchen.view'), ('kitchen.update'), ('tables.view'), ('tables.manage'), ('reservations.view'),
  ('reservations.manage'), ('bills.print'), ('payments.view'), ('payments.take'), ('payments.refund'),
  ('customers.view'), ('customers.manage'), ('reports.view'), ('staff.manage'), ('locations.manage'),
  ('settings.manage'), ('settings.branding'), ('billing.manage');

-- ---------------------------------------------------------------------------------------------
-- default_role_permissions: the template copied into each new organization's system roles.
-- Owner has no rows: it is implicit (everything), so a new permission never needs a backfill.
-- A permission added later must be added here for Manager and in a backfill for existing orgs.
-- ---------------------------------------------------------------------------------------------
create table public.default_role_permissions (
  role_key text not null check (role_key in ('manager', 'cashier', 'waiter', 'kitchen')),
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

alter table public.default_role_permissions enable row level security;
grant select on table public.default_role_permissions to service_role;

insert into public.default_role_permissions (role_key, permission_key)
select 'manager', key from public.permissions
where key not in ('billing.manage', 'settings.manage', 'locations.manage');

insert into public.default_role_permissions (role_key, permission_key)
select r.role_key, p.permission_key
from (values
  ('cashier', array['pos.use','orders.view','orders.create','bills.print','payments.view','payments.take','customers.view','kitchen.view','tables.view']),
  ('waiter',  array['pos.use','orders.view','orders.create','bills.print','kitchen.view','tables.view','reservations.view']),
  ('kitchen', array['kitchen.view','kitchen.update','orders.view'])
) as r(role_key, perms)
cross join lateral unnest(r.perms) as p(permission_key);

-- ---------------------------------------------------------------------------------------------
-- roles: per organization. Five system roles (system_key set) plus custom roles.
-- ---------------------------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  system_key text check (system_key in ('owner', 'manager', 'cashier', 'waiter', 'kitchen')),
  is_system boolean not null default false,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_system_key_matches check (is_system = (system_key is not null)),
  -- Lets other tables reference a role together with its org.
  constraint roles_org_id_id_key unique (org_id, id)
);

alter table public.roles enable row level security;

create unique index roles_org_system_key_idx on public.roles (org_id, system_key) where system_key is not null;
create unique index roles_org_name_idx on public.roles (org_id, lower(name));

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on table public.roles to service_role;

-- ---------------------------------------------------------------------------------------------
-- role_permissions. org_id is carried so the composite key ties the role to the same org.
-- ---------------------------------------------------------------------------------------------
create table public.role_permissions (
  role_id uuid not null,
  org_id uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key),
  constraint role_permissions_role_fkey
    foreign key (org_id, role_id) references public.roles (org_id, id) on delete cascade
);

alter table public.role_permissions enable row level security;
create index role_permissions_org_idx on public.role_permissions (org_id);
create index role_permissions_permission_idx on public.role_permissions (permission_key);

grant select, insert, delete on table public.role_permissions to service_role;

-- ---------------------------------------------------------------------------------------------
-- organization_members. One row per (org, user). No delete: a member is deactivated.
-- ---------------------------------------------------------------------------------------------
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null,
  status text not null default 'active' check (status in ('active', 'deactivated')),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_org_user_key unique (org_id, user_id),
  constraint organization_members_org_id_id_key unique (org_id, id),
  constraint organization_members_deactivated_has_time check (status <> 'deactivated' or deactivated_at is not null),
  -- The role must belong to the same organization.
  constraint organization_members_role_fkey
    foreign key (org_id, role_id) references public.roles (org_id, id) on delete restrict
);

alter table public.organization_members enable row level security;
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_role_idx on public.organization_members (org_id, role_id);

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function private.set_updated_at();

grant select, insert, update on table public.organization_members to service_role;

-- ---------------------------------------------------------------------------------------------
-- location_staff: which locations a member works at. Both keys carry org_id, so a member can't be
-- linked to another tenant's location.
-- ---------------------------------------------------------------------------------------------
create table public.location_staff (
  member_id uuid not null,
  location_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (member_id, location_id),
  constraint location_staff_member_fkey
    foreign key (org_id, member_id) references public.organization_members (org_id, id) on delete cascade,
  constraint location_staff_location_fkey
    foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);

alter table public.location_staff enable row level security;
create index location_staff_location_idx on public.location_staff (org_id, location_id);

grant select, insert, delete on table public.location_staff to service_role;

-- ---------------------------------------------------------------------------------------------
-- System roles can't be changed or deleted. Only the seed below (a trigger inside a trigger,
-- pg_trigger_depth() > 1) writes them. A cascade from a deleted organization is allowed.
-- ---------------------------------------------------------------------------------------------
create function private.protect_system_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_system and pg_trigger_depth() <= 1 then
      raise exception 'system roles are created with the organization' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_system or new.is_system then
      raise exception 'system roles cannot be changed' using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if old.is_system and exists (select 1 from public.organizations o where o.id = old.org_id) then
    raise exception 'system roles cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger roles_protect_system
  before insert or update or delete on public.roles
  for each row execute function private.protect_system_roles();

create function private.protect_system_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid := case when tg_op = 'DELETE' then old.role_id else new.role_id end;
  v_org_id uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
begin
  if exists (select 1 from public.roles r where r.id = v_role_id and r.is_system)
     and pg_trigger_depth() <= 1
     and exists (select 1 from public.organizations o where o.id = v_org_id) then
    raise exception 'system role permissions cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger role_permissions_protect_system
  before insert or update or delete on public.role_permissions
  for each row execute function private.protect_system_role_permissions();

-- ---------------------------------------------------------------------------------------------
-- Every new organization gets its five system roles and their permissions.
-- ---------------------------------------------------------------------------------------------
create function private.seed_org_roles(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (org_id, system_key, is_system, name)
  values
    (p_org_id, 'owner', true, 'Owner'),
    (p_org_id, 'manager', true, 'Manager'),
    (p_org_id, 'cashier', true, 'Cashier'),
    (p_org_id, 'waiter', true, 'Waiter'),
    (p_org_id, 'kitchen', true, 'Kitchen');

  insert into public.role_permissions (role_id, org_id, permission_key)
  select r.id, r.org_id, d.permission_key
  from public.roles r
  join public.default_role_permissions d on d.role_key = r.system_key
  where r.org_id = p_org_id and r.is_system;
end;
$$;

create function private.organizations_seed_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_org_roles(new.id);
  return new;
end;
$$;

create trigger organizations_seed_roles
  after insert on public.organizations
  for each row execute function private.organizations_seed_roles();

-- Organizations that exist before this migration (hosted staging).
do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations loop
    perform private.seed_org_roles(v_org);
  end loop;
end;
$$;
