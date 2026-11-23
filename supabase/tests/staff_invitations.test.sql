-- M0-BE-09: invitations store only a hash, cap expiry, stay inside one tenant, and have no client access.
begin;
select plan(34);

select has_table('public'::name, t::name) from unnest(array['staff_invitations','staff_invitation_locations']) t;
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.staff_invitations'::regclass,'public.staff_invitation_locations'::regclass)), 'RLS on');

insert into public.organizations (name, slug) values ('Org One', 'org-one'), ('Org Two', 'org-two');
insert into public.locations (org_id, name) select id, 'Loc ' || slug from public.organizations;
create temp table ctx on commit drop as
select
  (select id from public.organizations where slug = 'org-one') as o1,
  (select id from public.organizations where slug = 'org-two') as o2,
  (select r.id from public.roles r join public.organizations o on o.id = r.org_id where o.slug = 'org-one' and r.system_key = 'cashier') as role1,
  (select r.id from public.roles r join public.organizations o on o.id = r.org_id where o.slug = 'org-two' and r.system_key = 'cashier') as role2,
  (select l.id from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'org-one') as loc1,
  (select l.id from public.locations l join public.organizations o on o.id = l.org_id where o.slug = 'org-two') as loc2;
grant select on ctx to service_role;

-- Only a 32-byte SHA-256 hash fits the column
select lives_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'cash@example.test', role1, sha256(convert_to('token-1', 'UTF8')), now() + interval '3 days' from ctx$$, 'a SHA-256 hash is stored');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'b@example.test', role1, convert_to('a-raw-token-value-of-some-length-here', 'UTF8'), now() + interval '1 day' from ctx$$, '23514', null, 'raw token bytes refused');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'b@example.test', role1, decode(repeat('ab', 31), 'hex'), now() + interval '1 day' from ctx$$, '23514', null, '31 bytes refused');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'b@example.test', role1, decode(repeat('ab', 33), 'hex'), now() + interval '1 day' from ctx$$, '23514', null, '33 bytes refused');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'b@example.test', role1, sha256(convert_to('token-1', 'UTF8')), now() + interval '1 day' from ctx$$, '23505', null, 'token hash unique');
select is((select data_type from information_schema.columns where table_name = 'staff_invitations' and column_name = 'token_hash'), 'bytea', 'token_hash is bytea');

-- Expiry cap
select lives_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'seven@example.test', role1, sha256(convert_to('t7', 'UTF8')), now() + interval '7 days' from ctx$$, 'exactly 7 days is allowed');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'eight@example.test', role1, sha256(convert_to('t8', 'UTF8')), now() + interval '7 days 1 hour' from ctx$$, '23514', null, 'expiry over the cap refused');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'past@example.test', role1, sha256(convert_to('tp', 'UTF8')), now() - interval '1 hour' from ctx$$, '23514', null, 'expiry before creation refused');
select throws_ok($$update public.staff_invitations set expires_at = created_at + interval '30 days' where email = 'cash@example.test'$$, '23514', null, 'cap also holds on update');

-- Email normalized
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'Upper@Example.test', role1, sha256(convert_to('te1', 'UTF8')), now() + interval '1 day' from ctx$$, '23514', null, 'uppercase email refused');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, ' pad@example.test', role1, sha256(convert_to('te2', 'UTF8')), now() + interval '1 day' from ctx$$, '23514', null, 'untrimmed email refused');
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'not-an-email', role1, sha256(convert_to('te3', 'UTF8')), now() + interval '1 day' from ctx$$, '23514', null, 'email shape checked');

-- One open invitation per (org, email); same email elsewhere or after closing is fine
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'cash@example.test', role1, sha256(convert_to('dup', 'UTF8')), now() + interval '1 day' from ctx$$, '23505', null, 'second open invitation refused');
select lives_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o2, 'cash@example.test', role2, sha256(convert_to('other-org', 'UTF8')), now() + interval '1 day' from ctx$$, 'same email in another org is fine');

-- Cross-tenant role
select throws_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'cross@example.test', role2, sha256(convert_to('cr', 'UTF8')), now() + interval '1 day' from ctx$$, '23503', null, 'role from another org refused');

-- Locations
select lives_ok($$insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
  select i.id, c.loc1, c.o1 from public.staff_invitations i, ctx c where i.email = 'cash@example.test' and i.org_id = c.o1$$, 'own location listed');
select throws_ok($$insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
  select i.id, c.loc2, c.o1 from public.staff_invitations i, ctx c where i.email = 'cash@example.test' and i.org_id = c.o1$$, '23503', null, 'location from another org refused');
select throws_ok($$insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
  select i.id, c.loc2, c.o2 from public.staff_invitations i, ctx c where i.email = 'cash@example.test' and i.org_id = c.o1$$, '23503', null, 'invitation of another org refused');
select throws_ok($$update public.staff_invitations set all_locations = true where email = 'cash@example.test' and org_id = (select o1 from ctx)$$, '23514', null, 'all_locations refused while a list exists');
select lives_ok($$update public.staff_invitations set all_locations = true where email = 'seven@example.test'$$, 'all_locations on a list-free invitation');
select throws_ok($$insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
  select i.id, c.loc1, c.o1 from public.staff_invitations i, ctx c where i.email = 'seven@example.test'$$, '23514', null, 'no list for an all_locations invitation');

-- Accepted and revoked
select throws_ok($$update public.staff_invitations set accepted_at = now(), revoked_at = now() where email = 'cash@example.test' and org_id = (select o1 from ctx)$$, '23514', null, 'accepted and revoked are mutually exclusive');
select lives_ok($$update public.staff_invitations set revoked_at = now() where email = 'cash@example.test' and org_id = (select o1 from ctx)$$, 'revoke');
select throws_ok($$update public.staff_invitations set revoked_at = null where email = 'cash@example.test' and org_id = (select o1 from ctx)$$, '55000', null, 'a revoked invitation cannot be reopened');
select throws_ok($$update public.staff_invitations set accepted_at = now() where email = 'cash@example.test' and org_id = (select o1 from ctx)$$, '55000', null, 'a revoked invitation cannot be accepted');
select lives_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select o1, 'cash@example.test', role1, sha256(convert_to('resend', 'UTF8')), now() + interval '2 days' from ctx$$, 'after revoking, a new open invitation is allowed');

-- No client access
set local role anon;
select throws_ok($$select 1 from public.staff_invitations$$, '42501', null, 'anon: invitations');
reset role;
set local role authenticated;
select throws_ok($$select 1 from public.staff_invitations$$, '42501', null, 'authenticated: invitations');
select throws_ok($$select 1 from public.staff_invitation_locations$$, '42501', null, 'authenticated: invitation locations');
select throws_ok($$update public.staff_invitations set revoked_at = now()$$, '42501', null, 'authenticated: write');
reset role;

select * from finish();
rollback;
