-- M0-BE-10: access helpers, client RPCs, and the first member read policies.
--
-- Rules for everything below:
-- * Helpers that RLS policies call live in `private`: security definer, search_path = '', stable,
--   with (select auth.uid()) inside. Only the helpers policies need are granted to authenticated
--   (plus usage on the schema). anon gets nothing.
-- * Every check fails closed: null or unknown input, a non-member, a deactivated member and a
--   suspended organization all give false / no rows.
-- * Client RPCs live in public, derive the user from auth.uid() (never from an argument) and return
--   only the caller's own data.

-- ---------------------------------------------------------------------------------------------
-- Policy helpers (private)
-- ---------------------------------------------------------------------------------------------
create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid())),
    false
  );
$$;

-- Active member of an active organization.
create function private.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.org_id
      where m.org_id = p_org_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and o.status = 'active'
    ),
    false
  );
$$;

-- The caller's active membership id in an active organization, or null.
create function private.my_member_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.organization_members m
  join public.organizations o on o.id = m.org_id
  where m.org_id = p_org_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.status = 'active';
$$;

-- Owner is implicit: every catalog permission. Other roles: their role_permissions rows.
-- An unknown permission key is false even for an owner.
create function private.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.org_id
      join public.roles r on r.org_id = m.org_id and r.id = m.role_id
      join public.permissions p on p.key = p_permission
      where m.org_id = p_org_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and o.status = 'active'
        and (
          r.system_key = 'owner'
          or exists (
            select 1 from public.role_permissions rp
            where rp.role_id = r.id and rp.permission_key = p.key
          )
        )
    ),
    false
  );
$$;

-- Owner and Manager reach every location of the org. Everyone else only their location_staff rows.
create function private.has_location_access(p_org_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.org_id
      join public.roles r on r.org_id = m.org_id and r.id = m.role_id
      join public.locations l on l.org_id = m.org_id and l.id = p_location_id
      where m.org_id = p_org_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and o.status = 'active'
        and (
          r.system_key in ('owner', 'manager')
          or exists (
            select 1 from public.location_staff s
            where s.member_id = m.id and s.location_id = l.id and s.org_id = m.org_id
          )
        )
    ),
    false
  );
$$;

revoke all on function private.is_platform_admin() from public, anon;
revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.my_member_id(uuid) from public, anon;
revoke all on function private.has_permission(uuid, text) from public, anon;
revoke all on function private.has_location_access(uuid, uuid) from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.my_member_id(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.has_location_access(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Server-side helpers: granted to no API role. Called from other definer functions (RPCs) and by
-- postgres.
-- ---------------------------------------------------------------------------------------------
-- The current package's limit for an org. null means unlimited. Keys: locations, staff, tables.
-- Fails closed: an org without a current subscription gets 0, never "unlimited". An unknown key
-- raises, so a typo can't read as unlimited.
create function private.org_limit(p_org_id uuid, p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pkg public.packages;
begin
  if p_key not in ('locations', 'staff', 'tables') then
    raise exception 'unknown limit key' using errcode = '22023';
  end if;

  select p.* into v_pkg
  from public.subscriptions s
  join public.packages p on p.id = s.package_id
  where s.org_id = p_org_id and s.status in ('trialing', 'active', 'past_due');

  if not found then
    return 0;
  end if;

  return case p_key
    when 'locations' then v_pkg.max_locations
    when 'staff' then v_pkg.max_staff
    else v_pkg.max_tables
  end;
end;
$$;

-- Appends an audit row with actor = auth.uid(). Keep personal data out of p_metadata: no names,
-- emails, phone numbers or tokens; use ids and changed field names instead.
create function private.write_audit(
  p_org_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_logs (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org_id, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id;
$$;

revoke all on function private.org_limit(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Client RPCs (public). Only the caller's own data.
-- ---------------------------------------------------------------------------------------------
-- Permission keys the caller holds in an org. Empty for a non-member, a deactivated member or a
-- suspended org.
create function public.my_permissions(p_org_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.key
  from public.organization_members m
  join public.organizations o on o.id = m.org_id
  join public.roles r on r.org_id = m.org_id and r.id = m.role_id
  join public.permissions p
    on r.system_key = 'owner'
    or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = p.key)
  where m.org_id = p_org_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.status = 'active'
  order by p.key;
$$;

-- The org's current package and subscription, for any active member.
create function public.get_org_package(p_org_id uuid)
returns table (
  package_key text,
  package_name text,
  subscription_status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  max_locations integer,
  max_staff integer,
  max_tables integer,
  features jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.key, p.name, s.status, s.trial_ends_at, s.current_period_end,
    p.max_locations, p.max_staff, p.max_tables,
    jsonb_build_object(
      'online_payments', p.feature_online_payments,
      'reservations', p.feature_reservations,
      'customers', p.feature_customers,
      'custom_roles', p.feature_custom_roles,
      'staff_schedules', p.feature_staff_schedules,
      'advanced_reports', p.feature_advanced_reports,
      'csv_export', p.feature_csv_export,
      'theme_customization', p.feature_theme_customization,
      'custom_domain', p.feature_custom_domain,
      'loyalty', p.feature_loyalty
    )
  from public.subscriptions s
  join public.packages p on p.id = s.package_id
  where s.org_id = p_org_id
    and s.status in ('trialing', 'active', 'past_due')
    and (select private.is_org_member(p_org_id));
$$;

-- The caller's own memberships (one org, or all when p_org_id is null), including deactivated ones
-- and suspended orgs, so the app can show the right notice. It grants nothing: access still goes
-- through the helpers above.
create function public.my_org_membership(p_org_id uuid default null)
returns table (
  org_id uuid,
  org_slug text,
  org_name text,
  org_status text,
  member_id uuid,
  member_status text,
  role_id uuid,
  role_key text,
  role_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, o.name, o.status, m.id, m.status, r.id, r.system_key, r.name
  from public.organization_members m
  join public.organizations o on o.id = m.org_id
  join public.roles r on r.org_id = m.org_id and r.id = m.role_id
  where m.user_id = (select auth.uid())
    and (p_org_id is null or m.org_id = p_org_id)
  order by o.created_at, o.id;
$$;

revoke all on function public.my_permissions(uuid) from public, anon;
revoke all on function public.get_org_package(uuid) from public, anon;
revoke all on function public.my_org_membership(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.get_org_package(uuid) to authenticated;
grant execute on function public.my_org_membership(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- First member read policies. Select only; writes stay server-only (service_role).
-- ---------------------------------------------------------------------------------------------
grant select on table public.organizations to authenticated;
grant select on table public.locations to authenticated;
grant select on table public.org_branding to authenticated;
grant select on table public.roles to authenticated;
grant select on table public.role_permissions to authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.location_staff to authenticated;
grant select on table public.audit_logs to authenticated;

create policy organizations_select_member on public.organizations
  for select to authenticated
  using ((select private.is_org_member(id)));

-- Owner and Manager see every location; others only the locations they work at.
create policy locations_select_access on public.locations
  for select to authenticated
  using ((select private.has_location_access(org_id, id)));

create policy org_branding_select_member on public.org_branding
  for select to authenticated
  using ((select private.is_org_member(org_id)));

create policy roles_select_member on public.roles
  for select to authenticated
  using ((select private.is_org_member(org_id)));

create policy role_permissions_select_member on public.role_permissions
  for select to authenticated
  using ((select private.is_org_member(org_id)));

-- A member sees their own row; the full list needs staff.manage.
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select private.is_org_member(org_id)))
    or (select private.has_permission(org_id, 'staff.manage'))
  );

create policy location_staff_select on public.location_staff
  for select to authenticated
  using (
    member_id = (select private.my_member_id(org_id))
    or (select private.has_permission(org_id, 'staff.manage'))
  );

-- The audit log needs settings.manage (Owner only by default), the stricter of the two candidates.
-- Widen it to staff.manage later if managers need to see it. Rows without an org stay server-only.
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (org_id is not null and (select private.has_permission(org_id, 'settings.manage')));
