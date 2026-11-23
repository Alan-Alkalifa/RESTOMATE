-- M0-BE-09: staff invitations.
-- M0-BE-29 baseline: no privilege until granted. RLS is on with no policy and anon/authenticated get
-- no grant: M0-BE-10/12 open access through helpers and accept_invitation. Only the server
-- (service_role) reads and writes.

-- ---------------------------------------------------------------------------------------------
-- staff_invitations. The raw token is never stored: only its SHA-256 hash (32 bytes), so a stored
-- value can't be turned back into a link. The server hashes with sha256(convert_to(token, 'UTF8'))
-- or the same digest in app code.
-- ---------------------------------------------------------------------------------------------
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Stored normalized (lowercase, trimmed); the check refuses anything else.
  email text not null check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^@\s]+@[^@\s]+$'
  ),
  role_id uuid not null,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  -- true: every location of the org. false: only the rows in staff_invitation_locations.
  all_locations boolean not null default false,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint staff_invitations_token_hash_key unique (token_hash),
  constraint staff_invitations_org_id_id_key unique (org_id, id),
  -- The role must belong to the same organization.
  constraint staff_invitations_role_fkey
    foreign key (org_id, role_id) references public.roles (org_id, id) on delete restrict,
  -- Expiry is capped at 7 days after creation.
  constraint staff_invitations_expiry_cap check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  -- Accepted and revoked are mutually exclusive; a user can only be recorded with an accept time.
  constraint staff_invitations_accepted_xor_revoked check (accepted_at is null or revoked_at is null),
  constraint staff_invitations_accepted_by_needs_time check (accepted_by is null or accepted_at is not null)
);

alter table public.staff_invitations enable row level security;

-- One open (not accepted, not revoked) invitation per organization and email. An expired one stays
-- open until revoked: resend = revoke the old row, then create a new one (M0-BE-22).
create unique index staff_invitations_one_open_idx
  on public.staff_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;
create index staff_invitations_role_idx on public.staff_invitations (org_id, role_id);
create index staff_invitations_invited_by_idx on public.staff_invitations (invited_by);

create trigger staff_invitations_set_updated_at
  before update on public.staff_invitations
  for each row execute function private.set_updated_at();

-- No delete: an invitation is closed by accepting or revoking it.
grant select, insert, update on table public.staff_invitations to service_role;

-- ---------------------------------------------------------------------------------------------
-- staff_invitation_locations: the location list when all_locations is false. Both keys carry
-- org_id, so a location of another tenant can't be listed.
-- ---------------------------------------------------------------------------------------------
create table public.staff_invitation_locations (
  invitation_id uuid not null,
  location_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (invitation_id, location_id),
  constraint staff_invitation_locations_invitation_fkey
    foreign key (org_id, invitation_id) references public.staff_invitations (org_id, id) on delete cascade,
  constraint staff_invitation_locations_location_fkey
    foreign key (org_id, location_id) references public.locations (org_id, id) on delete cascade
);

alter table public.staff_invitation_locations enable row level security;
create index staff_invitation_locations_location_idx on public.staff_invitation_locations (org_id, location_id);

grant select, insert, delete on table public.staff_invitation_locations to service_role;

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------
-- A closed invitation (accepted or revoked) never changes again, so a time can't be cleared to
-- reopen it and a token can't be reused.
create function private.freeze_closed_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'closed invitations cannot be changed' using errcode = '55000';
  end if;
  -- The list of locations only exists for all_locations = false.
  if new.all_locations and exists (
    select 1 from public.staff_invitation_locations l where l.invitation_id = new.id
  ) then
    raise exception 'invitation has a location list' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger staff_invitations_freeze_closed
  before update on public.staff_invitations
  for each row execute function private.freeze_closed_invitation();

-- Locations can be listed only on an open invitation that is not all_locations.
create function private.check_invitation_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
begin
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

create trigger staff_invitation_locations_check
  before insert or update on public.staff_invitation_locations
  for each row execute function private.check_invitation_location();
