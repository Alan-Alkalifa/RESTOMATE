-- M0-BE-13 (S4 from the M0-BE-11 QA): open invitations hold a staff slot on every path, and the
-- invitation location list is audited.
begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@example.test'
from generate_series(1, 10) n;

insert into public.packages (key, name, max_locations, max_staff) values ('five', 'Five staff (test)', 5, 5);
insert into public.organizations (name, slug) values ('Slots', 'slots-org');
insert into public.subscriptions (org_id, package_id, status)
select o.id, p.id, 'active' from public.organizations o, public.packages p where o.slug = 'slots-org' and p.key = 'five';
create temp table ctx on commit drop as select id as org from public.organizations where slug = 'slots-org';
insert into public.locations (org_id, name) select org, 'Main' from ctx;

create function pg_temp.uid(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0')), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.nouid() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create function pg_temp.add_member(p_user int, p_key text) returns uuid language sql as $$
  insert into public.organization_members (org_id, user_id, role_id)
  select c.org, ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0'))::uuid, r.id
  from ctx c join public.roles r on r.org_id = c.org and r.system_key = p_key
  returning id;
$$;
create function pg_temp.invite(p_email text, p_token text) returns uuid language sql as $$
  insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select c.org, p_email, r.id, sha256(convert_to(p_token, 'UTF8')), now() + interval '2 days'
  from ctx c join public.roles r on r.org_id = c.org and r.system_key = 'cashier'
  returning id;
$$;

-- Four active members and one open invitation: the five slots are taken
select pg_temp.add_member(1, 'owner');
select pg_temp.add_member(2, 'manager');
select pg_temp.add_member(3, 'waiter');
select pg_temp.add_member(4, 'kitchen');
select lives_ok($$select pg_temp.invite('u6@example.test', 'tok-6')$$, 'the fifth slot goes to an invitation');
select throws_ok($$select pg_temp.add_member(5, 'cashier')$$, 'P0001', 'PLAN_LIMIT:staff', 'a direct member add is refused: 4 active + 1 open invitation at limit 5');
select throws_ok($$select pg_temp.invite('u7@example.test', 'tok-7')$$, 'P0001', 'PLAN_LIMIT:staff', 'a second invitation is refused too');

-- Accepting does not count the invitation twice
select pg_temp.uid(6);
select lives_ok($$select * from public.accept_invitation('tok-6')$$, 'the invitee accepts at the limit without PLAN_LIMIT:staff');
select pg_temp.nouid();
select is((select count(*)::int from public.organization_members where org_id = (select org from ctx) and status = 'active'), 5, 'five active members');

-- Reactivation counts open invitations
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000004';
select lives_ok($$select pg_temp.invite('u8@example.test', 'tok-8')$$, 'a freed slot goes to an invitation');
select throws_ok($$update public.organization_members set status = 'active', deactivated_at = null where user_id = '00000000-0000-0000-0000-000000000004'$$, 'P0001', 'PLAN_LIMIT:staff', 'reactivating is refused while an open invitation holds the slot');
select pg_temp.uid(8);
select lives_ok($$select * from public.accept_invitation('tok-8')$$, 'and the invitee still gets in');
select pg_temp.nouid();

-- Reactivating an invited-then-deactivated member through a new invitation at the limit
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000008';
select lives_ok($$select pg_temp.invite('u8@example.test', 'tok-8b')$$, 'invite the deactivated member again');
select pg_temp.uid(8);
select lives_ok($$select * from public.accept_invitation('tok-8b')$$, 'reactivation through acceptance is not double-counted');
select pg_temp.nouid();

-- Expired and revoked invitations hold nothing
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000003';
insert into public.staff_invitations (org_id, email, role_id, token_hash, created_at, expires_at)
select c.org, 'u9@example.test', r.id, sha256('old'), now() - interval '3 days', now() - interval '1 day'
from ctx c join public.roles r on r.org_id = c.org and r.system_key = 'cashier';
select lives_ok($$update public.organization_members set status = 'active', deactivated_at = null where user_id = '00000000-0000-0000-0000-000000000003'$$, 'an expired invitation does not hold a slot');

-- Audit of the invitation location list: ids only
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000003';
select pg_temp.invite('u10@example.test', 'tok-10');
insert into public.staff_invitation_locations (invitation_id, location_id, org_id)
select i.id, l.id, l.org_id from public.staff_invitations i, public.locations l, ctx c where i.email = 'u10@example.test' and l.org_id = c.org;
select is((select count(*)::int from public.audit_logs where action = 'staff_invitation_location.created'), 1, 'adding a location to an invitation is audited');
select is((select array_agg(k order by k) from public.audit_logs a, jsonb_object_keys(a.metadata) k where a.action = 'staff_invitation_location.created'), array['invitation_id', 'location_id'], 'with ids only');
select is((select entity_id from public.audit_logs where action = 'staff_invitation_location.created'), (select id::text from public.staff_invitations where email = 'u10@example.test'), 'the entity id is the invitation');
delete from public.staff_invitation_locations;
select is((select count(*)::int from public.audit_logs where action = 'staff_invitation_location.deleted'), 1, 'removing it is audited');
select is((select count(*)::int from public.audit_logs where action like 'staff_invitation_location.%' and metadata::text ~ '@|example\.test'), 0, 'no email in the audit rows');
select lives_ok($$delete from public.organizations where slug = 'slots-org'$$, 'deleting the org still cascades');

select * from finish();
rollback;
