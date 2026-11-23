-- M0-BE-32: get_invitation_preview. One row of four columns; anon can call it; every reason that
-- is not "open" or "expired" gives the same answer; no email or id is ever returned.
begin;
select plan(29);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@example.test', now());

insert into public.packages (key, name) values ('prev_test', 'Preview test');
insert into public.organizations (name, slug) values ('Preview Org', 'preview-org'), ('Other Org', 'other-org');
insert into public.subscriptions (org_id, package_id, status)
select o.id, p.id, 'active' from public.organizations o, public.packages p where p.key = 'prev_test' and o.slug in ('preview-org', 'other-org');
insert into public.locations (org_id, name) select id, 'Main' from public.organizations where slug in ('preview-org', 'other-org');

create temp table ctx on commit drop as
select o.id as org, o.slug,
  (select r.id from public.roles r where r.org_id = o.id and r.system_key = 'cashier') as cashier
from public.organizations o where o.slug in ('preview-org', 'other-org');

create function pg_temp.invite(p_slug text, p_email text, p_token text, p_created interval, p_expires interval) returns uuid language sql as $$
  insert into public.staff_invitations (org_id, email, role_id, token_hash, created_at, expires_at, invited_by)
  select c.org, p_email, c.cashier, sha256(convert_to(p_token, 'UTF8')), now() - p_created, now() + p_expires, '00000000-0000-0000-0000-000000000001'
  from ctx c where c.slug = p_slug
  returning id;
$$;

-- Open and expired (a pending invitation past its time), plus the closed ones
select pg_temp.invite('preview-org', 'open@example.test', 'tok-open', interval '1 day', interval '2 days');
select pg_temp.invite('preview-org', 'expired@example.test', 'tok-expired', interval '3 days', interval '-1 day');
select pg_temp.invite('preview-org', 'accepted@example.test', 'tok-accepted', interval '1 day', interval '2 days');
update public.staff_invitations set accepted_at = now(), accepted_by = '00000000-0000-0000-0000-000000000001' where email = 'accepted@example.test';
select pg_temp.invite('preview-org', 'revoked@example.test', 'tok-revoked', interval '1 day', interval '2 days');
update public.staff_invitations set revoked_at = now() where email = 'revoked@example.test';
select pg_temp.invite('other-org', 'susp@example.test', 'tok-suspended', interval '1 day', interval '2 days');
update public.organizations set status = 'suspended' where slug = 'other-org';
-- A custom role name shows as it is
insert into public.roles (org_id, name) select org, 'Bar Lead' from ctx where slug = 'preview-org';
insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
select c.org, 'custom@example.test', r.id, sha256(convert_to('tok-custom', 'UTF8')), now() + interval '2 days'
from ctx c join public.roles r on r.org_id = c.org and r.name = 'Bar Lead' where c.slug = 'preview-org';

-- Grants and shape
select ok(has_function_privilege('anon', 'public.get_invitation_preview(text)', 'execute'), 'anon can call it');
select ok(has_function_privilege('authenticated', 'public.get_invitation_preview(text)', 'execute'), 'authenticated can call it');
select ok(not has_function_privilege('service_role', 'public.get_invitation_preview(text)', 'execute'), 'service_role does not need it');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.get_invitation_preview(text)'::regprocedure), 'security definer with an empty search_path');
select is(pg_get_function_result('public.get_invitation_preview(text)'::regprocedure), 'TABLE(org_name text, org_slug text, role_name text, status text)', 'exactly org_name, org_slug, role_name, status');

-- As anon, the way the invite page calls it
set local role anon;
select is((select count(*)::int from public.get_invitation_preview('tok-open')), 1, 'open: one row');
select is((select org_name || '/' || org_slug || '/' || role_name || '/' || status from public.get_invitation_preview('tok-open')), 'Preview Org/preview-org/Cashier/open', 'open: org, role and status');
select is((select org_name || '/' || org_slug || '/' || role_name || '/' || status from public.get_invitation_preview('tok-expired')), 'Preview Org/preview-org/Cashier/expired', 'expired: names and status expired');
select is((select role_name from public.get_invitation_preview('tok-custom')), 'Bar Lead', 'a custom role shows its name');
select is((select status from public.get_invitation_preview('tok-custom')), 'open', 'and is open');

-- Everything else is one answer
select is((select count(*)::int from public.get_invitation_preview('tok-accepted')), 1, 'accepted: one row');
select is((select to_jsonb(p)::text from public.get_invitation_preview('tok-accepted') p), '{"status": "unavailable", "org_name": null, "org_slug": null, "role_name": null}', 'accepted: unavailable, all names null');
select is((select to_jsonb(p) from public.get_invitation_preview('tok-revoked') p), (select to_jsonb(p) from public.get_invitation_preview('tok-accepted') p), 'revoked: the same answer as accepted');
select is((select to_jsonb(p) from public.get_invitation_preview('tok-suspended') p), (select to_jsonb(p) from public.get_invitation_preview('tok-accepted') p), 'suspended org: the same answer');
select is((select to_jsonb(p) from public.get_invitation_preview('no-such-token') p), (select to_jsonb(p) from public.get_invitation_preview('tok-accepted') p), 'unknown token: the same answer');
select is((select to_jsonb(p) from public.get_invitation_preview('') p), (select to_jsonb(p) from public.get_invitation_preview('tok-accepted') p), 'empty token: the same answer');
select is((select to_jsonb(p) from public.get_invitation_preview(null) p), (select to_jsonb(p) from public.get_invitation_preview('tok-accepted') p), 'no token: the same answer');
select is((select count(*)::int from public.get_invitation_preview('no-such-token')), 1, 'unknown: still one row');

-- The token is matched exactly (the hash), not as a prefix, a case variant or with spaces around it
select is((select status from public.get_invitation_preview('TOK-OPEN')), 'unavailable', 'case matters');
select is((select status from public.get_invitation_preview(' tok-open')), 'unavailable', 'so does a space');
select is((select status from public.get_invitation_preview('tok-ope')), 'unavailable', 'and a prefix is not a match');
-- The hash is not a token
select is((select status from public.get_invitation_preview(encode(sha256(convert_to('tok-open', 'UTF8')), 'hex'))), 'unavailable', 'the stored hash does not open the invitation');

-- No leak: no email, no id, no other column, whatever the status
select is((select array_agg(k order by k) from public.get_invitation_preview('tok-open') p, jsonb_object_keys(to_jsonb(p)) k), array['org_name', 'org_slug', 'role_name', 'status'], 'open: only the four columns');
select is((select count(*)::int from (select to_jsonb(p)::text t from public.get_invitation_preview('tok-open') p union all select to_jsonb(p)::text from public.get_invitation_preview('tok-expired') p union all select to_jsonb(p)::text from public.get_invitation_preview('tok-accepted') p) x where t ~* '@|example\.test|[0-9a-f]{8}-[0-9a-f]{4}-'), 0, 'no email and no UUID in any answer');

-- anon still can't read the tables themselves
select throws_ok($$select * from public.staff_invitations$$, '42501', null, 'anon cannot read invitations directly');

-- Signed in works the same
reset role;
set local role authenticated;
select is((select status from public.get_invitation_preview('tok-open')), 'open', 'authenticated: open');
select is((select status from public.get_invitation_preview('tok-revoked')), 'unavailable', 'authenticated: revoked is unavailable');
reset role;

-- Taking effect: a revoke closes it at once
select is((select status from public.get_invitation_preview('tok-open')), 'open', 'before revoking: open');
update public.staff_invitations set revoked_at = now() where email = 'open@example.test';
select is((select status from public.get_invitation_preview('tok-open')), 'unavailable', 'after revoking: unavailable');

select * from finish();
rollback;
