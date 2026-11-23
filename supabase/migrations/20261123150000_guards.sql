-- M0-BE-11: guards. Each forbidden write fails in the database, whoever writes it.
--
-- Error contract (the server maps these):
--   PLAN_LIMIT:<key>      P0001  a location / staff slot beyond the package
--   LAST_OWNER            P0001  would leave an active org without an active Owner
--   MEMBER_DELETE         P0001  members are deactivated, never deleted
--   MEMBER_KEYS_IMMUTABLE P0001  org_id and user_id of a member never change
--   ESCALATION_DENIED     42501  self role change, or a role / permission the actor doesn't hold
-- System-role protection already exists (M0-BE-08, current_user = 'postgres'); nothing is missing.
--
-- All guard and audit functions are SECURITY DEFINER with search_path = '': they call
-- private.org_limit and private.write_audit, which no API role may execute.
-- Escalation rules key on auth.uid(): a write with no auth.uid() (service_role, migrations) is
-- trusted server code; a definer RPC that sets auth.uid() (M0-BE-12) is held to the rules.

-- ---------------------------------------------------------------------------------------------
-- Plan limits
-- ---------------------------------------------------------------------------------------------
-- Current usage of a limit key. Staff counts active members; with p_count_invitations it also
-- counts open, unexpired invitations (they hold a slot).
-- 'tables' arrives with M2: that migration replaces this function (create or replace).
create function private.org_usage(p_org_id uuid, p_key text, p_count_invitations boolean default false)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key = 'locations' then
    select count(*) into v_count from public.locations where org_id = p_org_id;
  elsif p_key = 'staff' then
    select count(*) into v_count from public.organization_members where org_id = p_org_id and status = 'active';
    if p_count_invitations then
      v_count := v_count + (
        select count(*) from public.staff_invitations i
        where i.org_id = p_org_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      );
    end if;
  else
    raise exception 'usage for % is not available yet', p_key using errcode = '0A000';
  end if;
  return v_count;
end;
$$;

-- Raises PLAN_LIMIT:<key> when p_adding more would pass the package limit. null limit = unlimited,
-- no current subscription = 0 (private.org_limit). Locks the org row, so two concurrent inserts
-- are serialized: the second one counts the first one's row. Reusable for tables (M2).
create function private.check_plan_limit(
  p_org_id uuid,
  p_key text,
  p_adding integer default 1,
  p_count_invitations boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform 1 from public.organizations where id = p_org_id for no key update;
  v_limit := private.org_limit(p_org_id, p_key);
  if v_limit is null then
    return;
  end if;
  if private.org_usage(p_org_id, p_key, p_count_invitations) + p_adding > v_limit then
    raise exception 'PLAN_LIMIT:%', p_key using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Escalation
-- ---------------------------------------------------------------------------------------------
-- The acting user (auth.uid()) may give p_role_id in p_org_id only if they are an active member
-- who holds every permission of the role, and only an Owner may give the Owner role. No acting
-- user = trusted server code. The one exception: the creator of a brand-new org may add themself
-- as its Owner.
create function private.assert_can_assign_role(p_org_id uuid, p_role_id uuid, p_bootstrap_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.roles;
begin
  if v_uid is null then
    return;
  end if;

  select * into v_role from public.roles where id = p_role_id and org_id = p_org_id;
  if not found then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;

  if p_bootstrap_user = v_uid and v_role.system_key = 'owner'
     and not exists (select 1 from public.organization_members m where m.org_id = p_org_id) then
    return;
  end if;

  if not private.is_org_member(p_org_id) then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;

  if v_role.system_key = 'owner' then
    if not exists (
      select 1 from public.organization_members m
      join public.roles r on r.org_id = m.org_id and r.id = m.role_id
      where m.org_id = p_org_id and m.user_id = v_uid and m.status = 'active' and r.system_key = 'owner'
    ) then
      raise exception 'ESCALATION_DENIED' using errcode = '42501';
    end if;
    return;
  end if;

  if exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role_id and not private.has_permission(p_org_id, rp.permission_key)
  ) then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------------------------
create function private.guard_location_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_plan_limit(new.org_id, 'locations');
  return new;
end;
$$;

create trigger locations_guard_insert
  before insert on public.locations
  for each row execute function private.guard_location_insert();

-- ---------------------------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------------------------
create function private.is_owner_role(p_org_id uuid, p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.system_key = 'owner' from public.roles r where r.org_id = p_org_id and r.id = p_role_id),
    false
  );
$$;

create function private.guard_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.check_plan_limit(new.org_id, 'staff');
  end if;
  perform private.assert_can_assign_role(new.org_id, new.role_id, new.user_id);
  return new;
end;
$$;

create trigger organization_members_guard_insert
  before insert on public.organization_members
  for each row execute function private.guard_member_insert();

create function private.guard_member_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.org_id <> old.org_id or new.user_id <> old.user_id then
    raise exception 'MEMBER_KEYS_IMMUTABLE' using errcode = 'P0001';
  end if;

  -- A member never changes their own role.
  if new.role_id <> old.role_id and v_uid is not null and old.user_id = v_uid then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;

  -- Reactivating takes a staff slot.
  if old.status = 'deactivated' and new.status = 'active' then
    perform private.check_plan_limit(new.org_id, 'staff');
  end if;

  -- Never leave an active org without an active Owner.
  if old.status = 'active'
     and private.is_owner_role(old.org_id, old.role_id)
     and (new.status <> 'active' or not private.is_owner_role(new.org_id, new.role_id)) then
    perform 1 from public.organizations where id = old.org_id for no key update;
    if not exists (
      select 1 from public.organization_members m
      where m.org_id = old.org_id and m.id <> old.id and m.status = 'active'
        and private.is_owner_role(m.org_id, m.role_id)
    ) then
      raise exception 'LAST_OWNER' using errcode = 'P0001';
    end if;
  end if;

  if new.role_id <> old.role_id then
    perform private.assert_can_assign_role(new.org_id, new.role_id);
  end if;

  return new;
end;
$$;

create trigger organization_members_guard_update
  before update on public.organization_members
  for each row execute function private.guard_member_update();

-- Members are deactivated, never deleted. Only the cascade from a deleted organization removes them.
create function private.guard_member_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations o where o.id = old.org_id) then
    raise exception 'MEMBER_DELETE' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger organization_members_guard_delete
  before delete on public.organization_members
  for each row execute function private.guard_member_delete();

-- ---------------------------------------------------------------------------------------------
-- staff_invitations. An open invitation holds a staff slot, so invitations count toward staff here.
-- (Member inserts count active members only, so accepting an invitation doesn't count it twice.)
-- ---------------------------------------------------------------------------------------------
create function private.guard_invitation_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.check_plan_limit(new.org_id, 'staff', 1, true);
    perform private.assert_can_assign_role(new.org_id, new.role_id);
  elsif new.role_id <> old.role_id then
    perform private.assert_can_assign_role(new.org_id, new.role_id);
  end if;
  return new;
end;
$$;

create trigger staff_invitations_guard_write
  before insert or update on public.staff_invitations
  for each row execute function private.guard_invitation_write();

-- ---------------------------------------------------------------------------------------------
-- role_permissions of custom roles: nobody grants a permission they lack.
-- (System roles are seeded by the organization trigger and protected since M0-BE-08.)
-- ---------------------------------------------------------------------------------------------
create function private.guard_role_permission_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or exists (select 1 from public.roles r where r.id = new.role_id and r.is_system) then
    return new;
  end if;
  if not private.is_org_member(new.org_id) or not private.has_permission(new.org_id, new.permission_key) then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger role_permissions_guard_insert
  before insert on public.role_permissions
  for each row execute function private.guard_role_permission_insert();

-- ---------------------------------------------------------------------------------------------
-- Audit. Role, member, location-staff and invitation changes write an audit row. Metadata holds
-- ids and the names of changed fields only: never an email, a name, a token hash or a value.
-- System role seeding is not audited (it is part of creating the organization). The actor is
-- auth.uid(), null for service_role writes.
-- ---------------------------------------------------------------------------------------------
create function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_org uuid := (v_row ->> 'org_id')::uuid;
  v_meta jsonb;
  v_changed text[];
begin
  -- A cascade from a deleted organization has no org to point at.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  if tg_table_name = 'roles' and (v_row ->> 'is_system')::boolean then
    return null;
  end if;
  if tg_table_name = 'role_permissions'
     and exists (select 1 from public.roles r where r.id = (v_row ->> 'role_id')::uuid and r.is_system) then
    return null;
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_meta
  from jsonb_each(v_row) e
  where e.key in ('id', 'role_id', 'member_id', 'location_id', 'user_id', 'permission_key');

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value and n.key <> 'updated_at';
    v_meta := v_meta || jsonb_build_object('changed', to_jsonb(coalesce(v_changed, array[]::text[])));
  end if;

  perform private.write_audit(
    v_org,
    tg_argv[0] || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    tg_argv[0],
    coalesce(v_row ->> 'id', v_row ->> 'member_id', v_row ->> 'role_id'),
    v_meta
  );
  return null;
end;
$$;

create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function private.audit_change('role');
create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function private.audit_change('role_permission');
create trigger organization_members_audit
  after insert or update or delete on public.organization_members
  for each row execute function private.audit_change('member');
create trigger location_staff_audit
  after insert or update or delete on public.location_staff
  for each row execute function private.audit_change('location_staff');
create trigger staff_invitations_audit
  after insert or update or delete on public.staff_invitations
  for each row execute function private.audit_change('staff_invitation');

-- updated_at: every table with the column already has private.set_updated_at (checked in pgTAP).
