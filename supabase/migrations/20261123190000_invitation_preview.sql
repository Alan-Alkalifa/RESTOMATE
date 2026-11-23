-- M0-BE-32: invitation preview. The invite page shows "Join <org> as <role>" from the token alone,
-- before anyone signs in or accepts.
--
-- get_invitation_preview(token) always returns exactly one row of four columns:
--   org_name, org_slug, role_name, status
--   status 'open'         a pending invitation of an active org: names filled in
--   status 'expired'      a pending invitation whose time is up: names filled in (the page can say
--                         whom to ask for a new one)
--   status 'unavailable'  anything else, all names null: an unknown token, an accepted or revoked
--                         invitation, a suspended org, no token. One answer for all of them, so a
--                         guess learns nothing (not even which of the reasons it was).
-- Never the email, the invitation id, the org id, the locations or who invited.
--
-- The token is hashed here, as accept_invitation does (sha256 of the UTF-8 text). The raw token is
-- not stored or logged by this function. Rate limiting is the app's job (the preview action).
-- Definer with search_path = '': anon has no access to the invitation tables, only to this function.

create function public.get_invitation_preview(p_token text)
returns table (org_name text, org_slug text, role_name text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.staff_invitations;
  v_org public.organizations;
  v_role_name text;
begin
  select i.* into v_inv
  from public.staff_invitations i
  where i.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and i.accepted_at is null and i.revoked_at is null;

  if found then
    select o.* into v_org from public.organizations o where o.id = v_inv.org_id;
    select r.name into v_role_name from public.roles r where r.org_id = v_inv.org_id and r.id = v_inv.role_id;
    -- An open invitation always has a role and an org; the checks keep the answer closed if not.
    if v_org.status = 'active' and v_role_name is not null then
      return query select
        v_org.name, v_org.slug, v_role_name,
        case when v_inv.expires_at > now() then 'open' else 'expired' end;
      return;
    end if;
  end if;

  return query select null::text, null::text, null::text, 'unavailable'::text;
end;
$$;

revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;
