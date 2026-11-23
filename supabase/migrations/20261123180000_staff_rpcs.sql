-- M0-BE-30: staff and role RPCs. Definer functions for every staff and role write, so the server's staff actions
-- (M0-BE-22) run with auth.uid() set and every M0-BE-11 guard applies to the caller. A
-- service_role write has no auth.uid() and skips the escalation checks by design, so the staff
-- actions use these instead.
--
-- Same rules as M0-BE-12: public schema, security definer, search_path = '', the user comes from
-- auth.uid() (never an argument), explicit execute grants to authenticated only. One transaction
-- per call: any failure leaves no row behind.
--
-- Error codes (message), P0001 unless noted:
--   UNAUTHENTICATED (28000)  no signed-in user
--   FORBIDDEN (42501)        no staff.manage in the org, or an id that doesn't exist or belongs to
--                            another org (one code for all three, so ids can't be probed)
--   EMAIL_INVALID            the email is not a valid address after trim + lowercase
--   TOKEN_INVALID            the token hash is not 32 bytes, or is already used
--   ROLE_INVALID             the role is not a role of this org
--   LOCATION_INVALID         a location outside the org or out of the caller's reach, a list with
--                            all_locations, or no list without it
--   ALREADY_MEMBER           the email belongs to an active member of the org
--   INVITATION_EXISTS        an open invitation for this email already exists
--   INVITATION_CLOSED        the invitation is already accepted or revoked
--   MEMBER_ALREADY_ACTIVE, MEMBER_ALREADY_DEACTIVATED, STATUS_INVALID
--   PLAN_FEATURE:custom_roles  the package has no custom roles
--   NAME_INVALID, ROLE_NAME_TAKEN, ROLE_SYSTEM (a system role can't be changed or deleted),
--   ROLE_IN_USE (a member or an invitation, open or closed, still points at the role),
--   PERMISSION_INVALID (an unknown permission key)
--   PLAN_LIMIT:staff, LAST_OWNER, ESCALATION_DENIED (42501) from the guards (M0-BE-11)

-- ---------------------------------------------------------------------------------------------
-- Helpers (private, no API role may execute them)
-- ---------------------------------------------------------------------------------------------
create function private.is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    join public.roles r on r.org_id = m.org_id and r.id = m.role_id
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.status = 'active'
      and r.system_key = 'owner'
  );
$$;

-- The location list an invitation may carry, checked for the caller: the same reach rule as
-- set_member_locations. An Owner hands out any location of the org; anyone else only locations
-- they reach themself, and all_locations only when they reach every location the org has.
-- Returns the de-duplicated list (empty for all_locations).
create function private.staff_invitation_location_ids(p_org_id uuid, p_all_locations boolean, p_location_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean := private.is_org_owner(p_org_id);
  v_ids uuid[];
begin
  if p_all_locations then
    if coalesce(cardinality(array_remove(p_location_ids, null)), 0) > 0 then
      raise exception 'LOCATION_INVALID' using errcode = 'P0001';
    end if;
    if not v_owner and exists (
      select 1 from public.locations l where l.org_id = p_org_id and not private.has_location_access(p_org_id, l.id)
    ) then
      raise exception 'LOCATION_INVALID' using errcode = 'P0001';
    end if;
    return array[]::uuid[];
  end if;

  if p_location_ids is null then
    raise exception 'LOCATION_INVALID' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids
  from unnest(p_location_ids) x where x is not null;

  if (select count(*) from public.locations l where l.org_id = p_org_id and l.id = any (v_ids))
     <> cardinality(v_ids) then
    raise exception 'LOCATION_INVALID' using errcode = 'P0001';
  end if;
  if not v_owner and exists (select 1 from unnest(v_ids) x where not private.has_location_access(p_org_id, x)) then
    raise exception 'LOCATION_INVALID' using errcode = 'P0001';
  end if;
  return v_ids;
end;
$$;

-- Inserts an invitation and its location list. The guards on staff_invitations run for the caller
-- (PLAN_LIMIT:staff counting open invitations, ESCALATION_DENIED). Expiry is the 7-day cap.
create function private.insert_staff_invitation(
  p_org_id uuid,
  p_email text,
  p_role_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[],
  p_token_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_constraint text;
begin
  begin
    insert into public.staff_invitations (org_id, email, role_id, token_hash, all_locations, invited_by, expires_at)
    values (p_org_id, p_email, p_role_id, p_token_hash, p_all_locations, (select auth.uid()), now() + interval '7 days')
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'staff_invitations_one_open_idx' then
      raise exception 'INVITATION_EXISTS' using errcode = 'P0001';
    end if;
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end;

  insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
  select v_id, x, p_org_id from unnest(p_location_ids) x;

  return v_id;
end;
$$;

-- The org of a member or invitation the caller may manage; FORBIDDEN otherwise, the same for an id
-- that doesn't exist and one from another org.
create function private.staff_manage_org(p_org_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_org_id is null or not private.has_permission(p_org_id, 'staff.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return p_org_id;
end;
$$;

-- Acting on someone else needs the rights of their current role (only an Owner acts on an Owner).
-- The member guard checks the same, but only after LAST_OWNER; checking first means a Manager
-- acting on the only Owner gets ESCALATION_DENIED, not LAST_OWNER. Acting on yourself is left to
-- the guards (self-deactivation is allowed, a self role change is not).
create function private.assert_can_act_on_member(p_member public.organization_members)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_member.user_id is distinct from (select auth.uid()) then
    perform private.assert_can_assign_role(p_member.org_id, p_member.role_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_staff_invitation. The server generates the token and passes only its SHA-256 hash. Returns the id.
-- ---------------------------------------------------------------------------------------------
create function public.create_staff_invitation(
  p_org_id uuid,
  p_email text,
  p_role_id uuid,
  p_token_hash bytea,
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.staff_manage_org(p_org_id);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ids uuid[];
begin
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'EMAIL_INVALID' using errcode = 'P0001';
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end if;
  if p_role_id is null or not exists (select 1 from public.roles r where r.org_id = v_org and r.id = p_role_id) then
    raise exception 'ROLE_INVALID' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = v_org and m.status = 'active' and lower(btrim(u.email)) = v_email
  ) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_ids := private.staff_invitation_location_ids(v_org, coalesce(p_all_locations, false), p_location_ids);
  return private.insert_staff_invitation(v_org, v_email, p_role_id, coalesce(p_all_locations, false), v_ids, p_token_hash);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- revoke_staff_invitation. The guard checks the caller against the invitation's role.
-- ---------------------------------------------------------------------------------------------
create function public.revoke_staff_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
begin
  perform private.staff_manage_org((select i.org_id from public.staff_invitations i where i.id = p_invitation_id));
  select * into v_inv from public.staff_invitations i where i.id = p_invitation_id for update;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'INVITATION_CLOSED' using errcode = 'P0001';
  end if;
  update public.staff_invitations set revoked_at = now() where id = v_inv.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- resend_staff_invitation. Revokes the open invitation and creates a new one with the same email, role
-- and locations (checked again for the caller). Returns the new id. Exactly one stays open.
-- ---------------------------------------------------------------------------------------------
create function public.resend_staff_invitation(p_invitation_id uuid, p_new_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
  v_ids uuid[];
begin
  perform private.staff_manage_org((select i.org_id from public.staff_invitations i where i.id = p_invitation_id));
  if p_new_token_hash is null or octet_length(p_new_token_hash) <> 32 then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001';
  end if;
  select * into v_inv from public.staff_invitations i where i.id = p_invitation_id for update;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'INVITATION_CLOSED' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(l.location_id), array[]::uuid[]) into v_ids
  from public.staff_invitation_locations l where l.invitation_id = v_inv.id;
  v_ids := private.staff_invitation_location_ids(v_inv.org_id, v_inv.all_locations, v_ids);

  update public.staff_invitations set revoked_at = now() where id = v_inv.id;
  return private.insert_staff_invitation(v_inv.org_id, v_inv.email, v_inv.role_id, v_inv.all_locations, v_ids, p_new_token_hash);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Members. The guards apply: LAST_OWNER, ESCALATION_DENIED (own role, a member whose role holds
-- permissions the caller lacks, a role the caller lacks), PLAN_LIMIT:staff on reactivation.
-- ---------------------------------------------------------------------------------------------
create function public.change_member_role(p_member_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.staff_manage_org((select m.org_id from public.organization_members m where m.id = p_member_id));
  v_member public.organization_members;
begin
  if p_role_id is null or not exists (select 1 from public.roles r where r.org_id = v_org and r.id = p_role_id) then
    raise exception 'ROLE_INVALID' using errcode = 'P0001';
  end if;
  select * into v_member from public.organization_members m where m.id = p_member_id for update;
  -- Nobody changes their own role (the guard says so too; checked here so a no-op is refused).
  if v_member.user_id = (select auth.uid()) then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;
  perform private.assert_can_act_on_member(v_member);
  if v_member.role_id = p_role_id then
    return;
  end if;
  update public.organization_members set role_id = p_role_id where id = p_member_id;
end;
$$;

-- set_member_status: 'active' or 'deactivated'. Not on yourself. Reactivation takes a staff slot
-- (PLAN_LIMIT:staff, counting open invitations). Deactivation ends every session of the user in the
-- same transaction (refresh tokens cascade with their session), so the member is signed out
-- atomically with the status change: the user is signed out everywhere, not only in this org.
-- Returns the member's user id.
create function public.set_member_status(p_member_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members;
begin
  perform private.staff_manage_org((select m.org_id from public.organization_members m where m.id = p_member_id));
  if p_status is null or p_status not in ('active', 'deactivated') then
    raise exception 'STATUS_INVALID' using errcode = 'P0001';
  end if;
  select * into v_member from public.organization_members m where m.id = p_member_id for update;
  if v_member.user_id = (select auth.uid()) then
    raise exception 'ESCALATION_DENIED' using errcode = '42501';
  end if;
  perform private.assert_can_act_on_member(v_member);

  if p_status = 'deactivated' then
    if v_member.status = 'deactivated' then
      raise exception 'MEMBER_ALREADY_DEACTIVATED' using errcode = 'P0001';
    end if;
    update public.organization_members set status = 'deactivated', deactivated_at = now() where id = v_member.id;
    delete from auth.sessions where user_id = v_member.user_id;
  else
    if v_member.status = 'active' then
      raise exception 'MEMBER_ALREADY_ACTIVE' using errcode = 'P0001';
    end if;
    update public.organization_members set status = 'active', deactivated_at = null where id = v_member.id;
  end if;
  return v_member.user_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Roles. Custom roles only (system roles can't be changed or deleted), and only when the package
-- has the custom_roles feature (create and update; deleting stays possible after a downgrade).
-- Nobody grants a permission they lack: the role_permissions guard raises ESCALATION_DENIED, and
-- changing or deleting a role needs every permission the role holds.
-- ---------------------------------------------------------------------------------------------
create function private.org_has_custom_roles(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.feature_custom_roles
    from public.subscriptions s join public.packages p on p.id = s.package_id
    where s.org_id = p_org_id and s.status in ('trialing', 'active', 'past_due')
  ), false);
$$;

-- Normalizes and checks a role name; the unicode-space check on the table stays the last word.
create function private.clean_role_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception 'NAME_INVALID' using errcode = 'P0001';
  end if;
  return v_name;
end;
$$;

-- Distinct, non-null permission keys, all of them in the catalog.
create function private.clean_permission_keys(p_keys text[])
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_keys text[];
begin
  select coalesce(array_agg(distinct k), array[]::text[]) into v_keys from unnest(p_keys) k where k is not null;
  if (select count(*) from public.permissions p where p.key = any (v_keys)) <> cardinality(v_keys) then
    raise exception 'PERMISSION_INVALID' using errcode = 'P0001';
  end if;
  return v_keys;
end;
$$;

create function public.create_role(p_org_id uuid, p_name text, p_description text, p_permission_keys text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.staff_manage_org(p_org_id);
  v_name text := private.clean_role_name(p_name);
  v_keys text[] := private.clean_permission_keys(coalesce(p_permission_keys, array[]::text[]));
  v_id uuid;
begin
  if not private.org_has_custom_roles(v_org) then
    raise exception 'PLAN_FEATURE:custom_roles' using errcode = 'P0001';
  end if;
  begin
    insert into public.roles (org_id, name, description) values (v_org, v_name, nullif(btrim(coalesce(p_description, '')), ''))
    returning id into v_id;
  exception
    when unique_violation then raise exception 'ROLE_NAME_TAKEN' using errcode = 'P0001';
    when check_violation then raise exception 'NAME_INVALID' using errcode = 'P0001';
  end;
  insert into public.role_permissions (role_id, org_id, permission_key)
  select v_id, v_org, k from unnest(v_keys) k;
  return v_id;
end;
$$;

-- Replaces name, description and the permission list. A null name or permission list keeps it.
-- Only the added permissions are checked by the guard; the caller must already hold every
-- permission the role has now.
create function public.update_role(p_role_id uuid, p_name text, p_description text, p_permission_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
  v_org uuid := private.staff_manage_org((select r.org_id from public.roles r where r.id = p_role_id));
  v_name text;
  v_keys text[];
begin
  select * into v_role from public.roles r where r.id = p_role_id for update;
  if v_role.is_system then
    raise exception 'ROLE_SYSTEM' using errcode = 'P0001';
  end if;
  if not private.org_has_custom_roles(v_org) then
    raise exception 'PLAN_FEATURE:custom_roles' using errcode = 'P0001';
  end if;
  v_name := case when p_name is null then v_role.name else private.clean_role_name(p_name) end;
  if p_permission_keys is not null then
    v_keys := private.clean_permission_keys(p_permission_keys);
  end if;
  perform private.assert_can_assign_role(v_org, p_role_id);

  begin
    update public.roles
    set name = v_name, description = nullif(btrim(coalesce(p_description, '')), '')
    where id = p_role_id;
  exception
    when unique_violation then raise exception 'ROLE_NAME_TAKEN' using errcode = 'P0001';
    when check_violation then raise exception 'NAME_INVALID' using errcode = 'P0001';
  end;

  if p_permission_keys is not null then
    delete from public.role_permissions rp where rp.role_id = p_role_id and rp.permission_key <> all (v_keys);
    insert into public.role_permissions (role_id, org_id, permission_key)
    select p_role_id, v_org, k from unnest(v_keys) k
    on conflict do nothing;
  end if;
end;
$$;

create function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
  v_org uuid := private.staff_manage_org((select r.org_id from public.roles r where r.id = p_role_id));
begin
  select * into v_role from public.roles r where r.id = p_role_id for update;
  if v_role.is_system then
    raise exception 'ROLE_SYSTEM' using errcode = 'P0001';
  end if;
  perform private.assert_can_assign_role(v_org, p_role_id);
  begin
    delete from public.roles where id = p_role_id;
  exception when foreign_key_violation then
    raise exception 'ROLE_IN_USE' using errcode = 'P0001';
  end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function private.is_org_owner(uuid) from public, anon, authenticated, service_role;
revoke all on function private.staff_invitation_location_ids(uuid, boolean, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.insert_staff_invitation(uuid, text, uuid, boolean, uuid[], bytea) from public, anon, authenticated, service_role;
revoke all on function private.staff_manage_org(uuid) from public, anon, authenticated, service_role;
revoke all on function private.assert_can_act_on_member(public.organization_members) from public, anon, authenticated, service_role;

revoke all on function private.org_has_custom_roles(uuid) from public, anon, authenticated, service_role;
revoke all on function private.clean_role_name(text) from public, anon, authenticated, service_role;
revoke all on function private.clean_permission_keys(text[]) from public, anon, authenticated, service_role;

revoke all on function public.create_staff_invitation(uuid, text, uuid, bytea, boolean, uuid[]) from public, anon, service_role;
revoke all on function public.revoke_staff_invitation(uuid) from public, anon, service_role;
revoke all on function public.resend_staff_invitation(uuid, bytea) from public, anon, service_role;
revoke all on function public.change_member_role(uuid, uuid) from public, anon, service_role;
revoke all on function public.set_member_status(uuid, text) from public, anon, service_role;
revoke all on function public.create_role(uuid, text, text, text[]) from public, anon, service_role;
revoke all on function public.update_role(uuid, text, text, text[]) from public, anon, service_role;
revoke all on function public.delete_role(uuid) from public, anon, service_role;

grant execute on function public.create_staff_invitation(uuid, text, uuid, bytea, boolean, uuid[]) to authenticated;
grant execute on function public.revoke_staff_invitation(uuid) to authenticated;
grant execute on function public.resend_staff_invitation(uuid, bytea) to authenticated;
grant execute on function public.change_member_role(uuid, uuid) to authenticated;
grant execute on function public.set_member_status(uuid, text) to authenticated;
grant execute on function public.create_role(uuid, text, text, text[]) to authenticated;
grant execute on function public.update_role(uuid, text, text, text[]) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;
