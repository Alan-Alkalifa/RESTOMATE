-- M0-BE-12: RPCs, plus the S4 hardening found in QA.
--
-- RPC rules: public schema, security definer, search_path = '', the user comes from auth.uid()
-- (never an argument), explicit execute grants. Errors are stable codes in the message, raised as
-- P0001 unless noted: the server maps them.
--   SLUG_INVALID, SLUG_RESERVED, SLUG_TAKEN, ORG_CAP, NAME_INVALID
--   INVITATION_INVALID (used, revoked, expired, unknown, unconfirmed email, suspended org: one code)
--   INVITATION_EMAIL_MISMATCH, ALREADY_MEMBER
--   FORBIDDEN (42501), LOCATION_INVALID, UNAUTHENTICATED (28000)
--   PLAN_LIMIT:<key>, LAST_OWNER, ESCALATION_DENIED from the guards (M0-BE-11)

-- ---------------------------------------------------------------------------------------------
-- S4 fixes
-- ---------------------------------------------------------------------------------------------
-- private.org_limit(org, NULL) raised nothing and returned the tables limit, because
-- `null not in (...)` is null.
create or replace function private.org_limit(p_org_id uuid, p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pkg public.packages;
begin
  if p_key is null or p_key not in ('locations', 'staff', 'tables') then
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

-- Role names are unique ignoring case, and carry no whitespace at either end. btrim only strips
-- spaces, so the check names the whitespace classes itself: \s (space, tab, newline, ...) plus the
-- common Unicode spaces (no-break space, en/em/thin spaces, zero-width space, line and paragraph
-- separators, narrow no-break space, ideographic space, byte order mark).
drop index public.roles_org_name_idx;
create unique index roles_org_name_idx on public.roles (org_id, lower(name));
alter table public.roles add constraint roles_name_trimmed check (
  name !~ '^[\s\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]'
  and name !~ '[\s\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]$'
);

-- The server (service_role) updates only columns that may change, so no API role can move a row
-- to another tenant (org_id) or rewrite a key, hash or owner. Definer functions run as postgres
-- and are not affected.
revoke update on table public.roles from service_role;
grant update (name, description) on table public.roles to service_role;

revoke update on table public.organizations from service_role;
grant update (name, slug, status, currency, timezone) on table public.organizations to service_role;

revoke update on table public.locations from service_role;
grant update (name, address, timezone, currency, tax_bps, service_charge_bps, tax_on_service)
  on table public.locations to service_role;

revoke update on table public.org_branding from service_role;
grant update (logo_url) on table public.org_branding to service_role;

revoke update on table public.organization_members from service_role;
grant update (role_id, status, deactivated_at) on table public.organization_members to service_role;

revoke update on table public.staff_invitations from service_role;
grant update (role_id, all_locations, expires_at, accepted_at, accepted_by, revoked_at)
  on table public.staff_invitations to service_role;

revoke update on table public.subscriptions from service_role;
grant update (package_id, status, trial_ends_at, current_period_start, current_period_end, canceled_at)
  on table public.subscriptions to service_role;

-- A member accepted through accept_invitation: the invitee, who is not a member yet (or is a
-- deactivated one), acts on their own row. True only while accept_invitation runs, for exactly the
-- invitation it just closed for this org, user and role: it sets the transaction-local setting
-- restomate.accepting_invitation and clears it before returning. API roles have no way to run SQL
-- of their own, only the RPCs, and the invitation row must match as well.
create function private.is_accepting_invitation(p_org_id uuid, p_user_id uuid, p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_invitations i
    where i.id::text = nullif(current_setting('restomate.accepting_invitation', true), '')
      and i.org_id = p_org_id and i.accepted_by = p_user_id and i.role_id = p_role_id
  );
$$;

create or replace function private.guard_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.check_plan_limit(new.org_id, 'staff');
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
    -- A member never changes their own role, and never reactivates themself (S4).
    if new.role_id <> old.role_id
       or (old.status = 'deactivated' and new.status = 'active') then
      raise exception 'ESCALATION_DENIED' using errcode = '42501';
    end if;
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

-- The token hash never changes once set; resend = revoke and create a new invitation.
create or replace function private.guard_invitation_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.check_plan_limit(new.org_id, 'staff', 1, true);
    perform private.assert_can_assign_role(new.org_id, new.role_id);
  else
    if new.token_hash <> old.token_hash then
      raise exception 'closed or open, an invitation token cannot change' using errcode = '55000';
    end if;
    -- Revoking or re-roling an invitation needs the rights of its current role. Accepting (the
    -- invitee sets accepted_at) is not an act on someone else's invitation, so it is not checked.
    if (new.revoked_at is distinct from old.revoked_at or new.role_id <> old.role_id) then
      perform private.assert_can_assign_role(old.org_id, old.role_id);
    end if;
    if new.role_id <> old.role_id then
      perform private.assert_can_assign_role(new.org_id, new.role_id);
    end if;
  end if;
  return new;
end;
$$;

-- The location list of a closed invitation is frozen: no insert, update or delete (a cascade from a
-- deleted invitation, location or organization still works).
create or replace function private.check_invitation_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
begin
  if tg_op = 'DELETE' then
    select * into v_inv from public.staff_invitations where id = old.invitation_id;
    -- A location that is itself being deleted takes its list rows with it (the foreign key cascade),
    -- even on a closed invitation; deleting just a list row of a closed invitation stays refused.
    if found and (v_inv.accepted_at is not null or v_inv.revoked_at is not null)
       and exists (select 1 from public.locations l where l.id = old.location_id) then
      raise exception 'closed invitations cannot be changed' using errcode = '55000';
    end if;
    return old;
  end if;

  select * into v_inv from public.staff_invitations where id = new.invitation_id;
  if v_inv.all_locations then
    raise exception 'invitation covers all locations' using errcode = '23514';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'closed invitations cannot be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger staff_invitation_locations_check on public.staff_invitation_locations;
create trigger staff_invitation_locations_check
  before insert or update or delete on public.staff_invitation_locations
  for each row execute function private.check_invitation_location();

-- ---------------------------------------------------------------------------------------------
-- is_slug_available(slug): same rules as the table. For signed-in users creating an organization.
-- Returns whether the slug can be used and, if not, why.
-- ---------------------------------------------------------------------------------------------
create function public.is_slug_available(p_slug text)
returns table (available boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if char_length(v_slug) not between 3 and 40
     or v_slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$' or v_slug ~ '--' then
    return query select false, 'SLUG_INVALID'::text;
  elsif exists (select 1 from public.reserved_slugs r where r.slug = v_slug) then
    return query select false, 'SLUG_RESERVED'::text;
  elsif exists (select 1 from public.organizations o where o.slug = v_slug) then
    return query select false, 'SLUG_TAKEN'::text;
  else
    return query select true, null::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_organization. One transaction: any failure rolls back every row.
-- ---------------------------------------------------------------------------------------------
-- The most organizations one user can own (active Owner member, any org status). One named value.
-- It is an abuse limit, not a pricing rule: M1 can change it here without touching the RPC.
create function private.max_owned_orgs()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3; $$;

create function public.create_organization(
  p_name text,
  p_slug text,
  p_timezone text default null,
  p_location_name text default null,
  p_address text default null,
  p_tax_bps integer default 0,
  p_service_charge_bps integer default 0,
  p_tax_on_service boolean default false
)
returns table (new_org_id uuid, new_org_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_org uuid;
  v_owner_role uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'NAME_INVALID' using errcode = 'P0001';
  end if;
  if char_length(v_slug) not between 3 and 40
     or v_slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$' or v_slug ~ '--' then
    raise exception 'SLUG_INVALID' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reserved_slugs r where r.slug = v_slug) then
    raise exception 'SLUG_RESERVED' using errcode = 'P0001';
  end if;

  -- Serialize this user's creations, so two requests can't both pass the cap.
  perform pg_advisory_xact_lock(hashtextextended('create_organization:' || v_uid::text, 0));
  if (
    select count(*) from public.organization_members m
    join public.roles r on r.org_id = m.org_id and r.id = m.role_id
    where m.user_id = v_uid and m.status = 'active' and r.system_key = 'owner'
  ) >= private.max_owned_orgs() then
    raise exception 'ORG_CAP' using errcode = 'P0001';
  end if;

  begin
    -- The trigger seeds the five system roles.
    insert into public.organizations (name, slug, timezone)
    values (v_name, v_slug, coalesce(p_timezone, 'Asia/Jakarta'))
    returning id into v_org;
  exception when unique_violation then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end;

  -- The trial first: limits read the subscription.
  perform private.start_default_trial(v_org);

  select r.id into v_owner_role from public.roles r where r.org_id = v_org and r.system_key = 'owner';
  insert into public.organization_members (org_id, user_id, role_id) values (v_org, v_uid, v_owner_role);

  insert into public.locations (org_id, name, address, timezone, tax_bps, service_charge_bps, tax_on_service)
  values (
    v_org,
    coalesce(nullif(btrim(coalesce(p_location_name, '')), ''), v_name),
    p_address,
    coalesce(p_timezone, 'Asia/Jakarta'),
    coalesce(p_tax_bps, 0),
    coalesce(p_service_charge_bps, 0),
    coalesce(p_tax_on_service, false)
  );

  perform private.write_audit(v_org, 'organization.created', 'organization', v_org::text, '{}'::jsonb);

  return query select v_org, v_slug;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- accept_invitation(token). The caller's confirmed auth email must equal the invitation email.
-- ---------------------------------------------------------------------------------------------
-- An invitation for a role that isn't all-locations copies its location list. all_locations = true
-- gives the member a location_staff row for every location the org has now (location_staff is the
-- only per-location access record; Owner and Manager reach every location regardless).
create function public.accept_invitation(p_token text)
returns table (joined_org_id uuid, joined_org_slug text, joined_member_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_confirmed boolean;
  v_inv public.staff_invitations;
  v_org public.organizations;
  v_member public.organization_members;
  v_member_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at is not null
    into v_email, v_confirmed
  from auth.users u where u.id = v_uid;

  -- One generic code for unknown, used, revoked and expired tokens, and for unconfirmed callers.
  select i.* into v_inv
  from public.staff_invitations i
  where i.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update;
  if not found or not coalesce(v_confirmed, false) then
    raise exception 'INVITATION_INVALID' using errcode = 'P0001';
  end if;

  select * into v_org from public.organizations where id = v_inv.org_id;
  if v_org.status <> 'active' then
    raise exception 'INVITATION_INVALID' using errcode = 'P0001';
  end if;

  if v_email is null or v_email <> v_inv.email then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_member from public.organization_members m
  where m.org_id = v_inv.org_id and m.user_id = v_uid for update;
  if found and v_member.status = 'active' then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  -- Close the invitation first: the member guards recognize this call by it (see
  -- private.is_accepting_invitation).
  update public.staff_invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;
  perform set_config('restomate.accepting_invitation', v_inv.id::text, true);

  if v_member.id is not null then
    update public.organization_members
    set role_id = v_inv.role_id, status = 'active', deactivated_at = null
    where id = v_member.id;
    v_member_id := v_member.id;
    delete from public.location_staff where member_id = v_member_id;
  else
    insert into public.organization_members (org_id, user_id, role_id)
    values (v_inv.org_id, v_uid, v_inv.role_id)
    returning id into v_member_id;
  end if;

  if v_inv.all_locations then
    insert into public.location_staff (member_id, location_id, org_id)
    select v_member_id, l.id, l.org_id from public.locations l where l.org_id = v_inv.org_id;
  else
    insert into public.location_staff (member_id, location_id, org_id)
    select v_member_id, il.location_id, il.org_id
    from public.staff_invitation_locations il where il.invitation_id = v_inv.id;
  end if;

  perform set_config('restomate.accepting_invitation', '', true);

  perform private.write_audit(v_inv.org_id, 'staff_invitation.accepted', 'staff_invitation', v_inv.id::text,
    jsonb_build_object('member_id', v_member_id, 'role_id', v_inv.role_id));

  return query select v_org.id, v_org.slug, v_member_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- set_member_locations(member_id, location_ids): atomic replace. Needs staff.manage in the
-- member's org; every location must belong to that org. A member that doesn't exist, or sits in
-- an org the caller can't manage, gives the same FORBIDDEN. Unless the caller is an Owner: they
-- can't edit their own locations, can't hand out a location they don't reach (LOCATION_INVALID),
-- and can't edit a member whose role they couldn't assign (FORBIDDEN).
-- ---------------------------------------------------------------------------------------------
create function public.set_member_locations(p_member_id uuid, p_location_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_target public.organization_members;
  v_ids uuid[];
  v_caller_owner boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_location_ids is null then
    raise exception 'LOCATION_INVALID' using errcode = 'P0001';
  end if;

  select m.org_id into v_org from public.organization_members m where m.id = p_member_id;
  if v_org is null or not private.has_permission(v_org, 'staff.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Serialize edits of the same member.
  select * into v_target from public.organization_members m where m.id = p_member_id for update;

  v_caller_owner := exists (
    select 1 from public.organization_members m
    join public.roles r on r.org_id = m.org_id and r.id = m.role_id
    where m.org_id = v_org and m.user_id = v_uid and m.status = 'active' and r.system_key = 'owner'
  );

  if not v_caller_owner then
    -- No widening your own reach, and the same rule as the member guards: nobody edits a member
    -- whose role holds permissions they lack (an Owner member only by an Owner).
    if v_target.user_id = v_uid then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    begin
      perform private.assert_can_assign_role(v_org, v_target.role_id);
    exception when insufficient_privilege then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end;
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids
  from unnest(p_location_ids) x where x is not null;

  if (select count(*) from public.locations l where l.org_id = v_org and l.id = any (v_ids))
     <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'LOCATION_INVALID' using errcode = 'P0001';
  end if;

  if not v_caller_owner and exists (
    select 1 from unnest(v_ids) x where not private.has_location_access(v_org, x)
  ) then
    -- A caller can only hand out locations they reach themself.
    raise exception 'LOCATION_INVALID' using errcode = 'P0001';
  end if;

  -- Atomic replace. A caller who isn't an Owner replaces only the part of the list they can reach:
  -- rows for locations outside their reach are left alone.
  delete from public.location_staff s
  where s.member_id = p_member_id and s.location_id <> all (v_ids)
    and (v_caller_owner or private.has_location_access(v_org, s.location_id));
  insert into public.location_staff (member_id, location_id, org_id)
  select p_member_id, l.id, v_org from public.locations l
  where l.org_id = v_org and l.id = any (v_ids)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- get_storefront(slug): public read for the customer site. Name, slug, logo and the locations'
-- public fields. A suspended org returns only the flag. No org id, member, role or subscription
-- data. (locations has no active flag yet: every location of an active org is returned.)
-- ---------------------------------------------------------------------------------------------
create function public.get_storefront(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.status <> 'active' then jsonb_build_object('slug', o.slug, 'suspended', true)
    else jsonb_build_object(
      'slug', o.slug,
      'suspended', false,
      'name', o.name,
      'logo_url', b.logo_url,
      'locations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'name', l.name, 'address', l.address, 'timezone', l.timezone,
          'currency', l.currency, 'tax_bps', l.tax_bps, 'service_charge_bps', l.service_charge_bps,
          'tax_on_service', l.tax_on_service) order by l.created_at, l.id)
        from public.locations l where l.org_id = o.id
      ), '[]'::jsonb)
    )
  end
  from public.organizations o
  left join public.org_branding b on b.org_id = o.id
  where o.slug = lower(btrim(coalesce(p_slug, '')));
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function public.is_slug_available(text) from public, anon;
revoke all on function public.create_organization(text, text, text, text, text, integer, integer, boolean) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.set_member_locations(uuid, uuid[]) from public, anon;
revoke all on function public.get_storefront(text) from public;
revoke all on function private.is_accepting_invitation(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.max_owned_orgs() from public, anon, authenticated, service_role;

grant execute on function public.is_slug_available(text) to authenticated;
grant execute on function public.create_organization(text, text, text, text, text, integer, integer, boolean) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.set_member_locations(uuid, uuid[]) to authenticated;
grant execute on function public.get_storefront(text) to anon, authenticated;
