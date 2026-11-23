-- M0-BE-13 (S4 from the M0-BE-11 QA): open invitations hold a staff slot on every path, and the
-- invitation location list is audited like the other staff tables.

-- A direct member insert or a reactivation now counts open, unexpired invitations as well, so an
-- invite and a direct add at the same moment can't both pass (5 active + 1 open invite at limit 5).
-- accept_invitation closes the invitation before it inserts or reactivates the member, so the
-- invitation being accepted is not counted twice.
create or replace function private.guard_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.check_plan_limit(new.org_id, 'staff', 1, true);
  end if;
  if not private.is_accepting_invitation(new.org_id, new.user_id, new.role_id) then
    perform private.assert_can_assign_role(new.org_id, new.role_id, new.user_id);
  end if;
  return new;
end;
$$;

create or replace function private.guard_member_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_self boolean := v_uid is not null and old.user_id = v_uid;
  v_accepting boolean := v_uid is not null and old.user_id = v_uid
    and private.is_accepting_invitation(new.org_id, v_uid, new.role_id);
begin
  if new.org_id <> old.org_id or new.user_id <> old.user_id then
    raise exception 'MEMBER_KEYS_IMMUTABLE' using errcode = 'P0001';
  end if;

  if v_self and not v_accepting then
    -- A member never changes their own role, and never reactivates themself.
    if new.role_id <> old.role_id
       or (old.status = 'deactivated' and new.status = 'active') then
      raise exception 'ESCALATION_DENIED' using errcode = '42501';
    end if;
  end if;

  -- Reactivating takes a staff slot, counting open invitations like an insert does.
  if old.status = 'deactivated' and new.status = 'active' then
    perform private.check_plan_limit(new.org_id, 'staff', 1, true);
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

  if not v_accepting then
    -- Acting on someone else's role or status needs the rights of their current role.
    if v_uid is not null and not v_self and (new.role_id <> old.role_id or new.status <> old.status) then
      perform private.assert_can_assign_role(old.org_id, old.role_id);
    end if;
    if new.role_id <> old.role_id then
      perform private.assert_can_assign_role(new.org_id, new.role_id);
    end if;
  end if;

  return new;
end;
$$;

-- The audit function learns the invitation location list: ids only (invitation, location), and the
-- entity id falls back to the invitation id.
create or replace function private.audit_change()
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
  where e.key in ('id', 'role_id', 'member_id', 'location_id', 'invitation_id', 'user_id', 'permission_key');

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
    coalesce(v_row ->> 'id', v_row ->> 'member_id', v_row ->> 'role_id', v_row ->> 'invitation_id'),
    v_meta
  );
  return null;
end;
$$;

create trigger staff_invitation_locations_audit
  after insert or update or delete on public.staff_invitation_locations
  for each row execute function private.audit_change('staff_invitation_location');
