-- M0-BE-11: each forbidden write fails in the database.
begin;
select plan(79);

insert into auth.users (id, instance_id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'person' || n || '@example.test'
from generate_series(1, 9) n;

-- Packages: 'lim' allows 2 locations and 3 staff; 'unl' has no limits.
insert into public.packages (key, name, max_locations, max_staff, max_tables) values ('lim', 'Limited (test)', 2, 3, 5), ('unl', 'Unlimited (test)', null, null, null);
insert into public.organizations (name, slug) values
  ('Limited', 'lim-org'), ('Limited two', 'lim2-org'), ('Free', 'free-org'), ('No subscription', 'nosub-org');
insert into public.subscriptions (org_id, package_id, status)
select o.id, (select id from public.packages where key = case when o.slug = 'free-org' then 'unl' else 'lim' end), 'active'
from public.organizations o where o.slug <> 'nosub-org';

create temp table ctx on commit drop as
select
  (select id from public.organizations where slug = 'lim-org') as lim,
  (select id from public.organizations where slug = 'lim2-org') as lim2,
  (select id from public.organizations where slug = 'free-org') as free,
  (select id from public.organizations where slug = 'nosub-org') as nosub;

create function pg_temp.add_member(p_org uuid, p_user int, p_key text) returns uuid language sql as $$
  insert into public.organization_members (org_id, user_id, role_id)
  select p_org, ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0'))::uuid, r.id
  from public.roles r where r.org_id = p_org and r.system_key = p_key
  returning id;
$$;
create function pg_temp.uid(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ('00000000-0000-0000-0000-0000000000' || lpad(p_user::text, 2, '0')), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.role_id(p_org uuid, p_key text) returns uuid language sql as $$
  select id from public.roles where org_id = p_org and system_key = p_key;
$$;
create function pg_temp.invite(p_org uuid, p_email text, p_key text) returns uuid language sql as $$
  insert into public.staff_invitations (org_id, email, role_id, token_hash, expires_at)
  select p_org, p_email, pg_temp.role_id(p_org, p_key), sha256(convert_to(p_email || random()::text, 'UTF8')), now() + interval '2 days'
  returning id;
$$;

-- ---------------------------------------------------------------------------------------------
-- updated_at: every table that has the column has the trigger
-- ---------------------------------------------------------------------------------------------
select is((
  select count(*)::int from information_schema.columns c
  where c.table_schema = 'public' and c.column_name = 'updated_at'
    and not exists (
      select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = format('public.%I', c.table_name)::regclass and not t.tgisinternal and p.proname = 'set_updated_at'
    )
), 0, 'every table with updated_at has the updated_at trigger');

-- ---------------------------------------------------------------------------------------------
-- Plan limits: locations
-- ---------------------------------------------------------------------------------------------
select lives_ok($$insert into public.locations (org_id, name) select lim, 'L1' from ctx$$, 'location 1 of 2');
select lives_ok($$insert into public.locations (org_id, name) select lim, 'L2' from ctx$$, 'location 2 of 2');
select throws_ok($$insert into public.locations (org_id, name) select lim, 'L3' from ctx$$, 'P0001', 'PLAN_LIMIT:locations', 'location 3 of 2 refused');
select throws_ok($$insert into public.locations (org_id, name) select nosub, 'N1' from ctx$$, 'P0001', 'PLAN_LIMIT:locations', 'no subscription = limit 0');
select lives_ok($$insert into public.locations (org_id, name) select free, 'F' || g from ctx, generate_series(1, 5) g$$, 'null limit = unlimited');
select lives_ok($$insert into public.locations (org_id, name) select lim2, 'M1' from ctx$$, 'another org has its own count');

-- ---------------------------------------------------------------------------------------------
-- Plan limits: staff, reactivation, invitations
-- ---------------------------------------------------------------------------------------------
select lives_ok($$select pg_temp.add_member((select lim from ctx), 1, 'owner')$$, 'staff 1 of 3');
select lives_ok($$select pg_temp.add_member((select lim from ctx), 2, 'manager')$$, 'staff 2 of 3');
select lives_ok($$select pg_temp.add_member((select lim from ctx), 3, 'cashier')$$, 'staff 3 of 3');
select throws_ok($$select pg_temp.add_member((select lim from ctx), 4, 'waiter')$$, 'P0001', 'PLAN_LIMIT:staff', 'staff 4 of 3 refused');
select lives_ok($$update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000003'$$, 'deactivate frees a slot');
select lives_ok($$select pg_temp.add_member((select lim from ctx), 4, 'waiter')$$, 'the freed slot can be used');
select throws_ok($$update public.organization_members set status = 'active', deactivated_at = null where user_id = '00000000-0000-0000-0000-000000000003'$$, 'P0001', 'PLAN_LIMIT:staff', 'reactivating beyond the limit refused');
select lives_ok($$update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000004'$$, 'deactivate again');
select lives_ok($$select pg_temp.invite((select lim from ctx), 'one@example.test', 'cashier')$$, 'an invitation takes the third slot');
select throws_ok($$select pg_temp.invite((select lim from ctx), 'two@example.test', 'cashier')$$, 'P0001', 'PLAN_LIMIT:staff', 'a second invitation is refused: members + open invitations');
select lives_ok($$select pg_temp.add_member((select lim from ctx), 5, 'waiter')$$, 'accepting counts members only, so the invited slot is not counted twice');
select lives_ok($$update public.staff_invitations set revoked_at = now() where email = 'one@example.test'$$, 'revoke');

-- expired and revoked invitations don't hold a slot
select lives_ok($$select pg_temp.add_member((select lim2 from ctx), 1, 'owner')$$, 'lim2: staff 1');
select lives_ok($$select pg_temp.add_member((select lim2 from ctx), 2, 'manager')$$, 'lim2: staff 2');
select lives_ok($$insert into public.staff_invitations (org_id, email, role_id, token_hash, created_at, expires_at)
  select lim2, 'old@example.test', pg_temp.role_id(lim2, 'cashier'), sha256('old'), now() - interval '3 days', now() - interval '1 day' from ctx$$, 'an invitation that has already expired');
select lives_ok($$select pg_temp.invite((select lim2 from ctx), 'new@example.test', 'cashier')$$, 'the expired one does not count');

select lives_ok($$select pg_temp.add_member((select free from ctx), g, 'cashier') from generate_series(5, 9) g$$, 'unlimited staff');
select lives_ok($$select pg_temp.invite((select free from ctx), 'u' || g || '@example.test', 'cashier') from generate_series(1, 6) g$$, 'unlimited invitations');

-- reusable function and its lock
select throws_ok($$select private.check_plan_limit((select lim from ctx), 'tables', 6)$$, '0A000', null, 'tables usage is not available until M2');
select throws_ok($$select private.check_plan_limit((select lim from ctx), 'bananas')$$, '22023', null, 'unknown key raises');
select ok(pg_get_functiondef('private.check_plan_limit(uuid,text,integer,boolean)'::regprocedure) like '%for no key update%', 'check_plan_limit locks the org row (concurrent inserts are serialized)');
select ok(not has_function_privilege('authenticated', 'private.check_plan_limit(uuid,text,integer,boolean)', 'execute'), 'API roles cannot run the limit check');
select ok(not has_function_privilege('service_role', 'private.assert_can_assign_role(uuid,uuid,uuid)', 'execute'), 'API roles cannot run the escalation check');

-- ---------------------------------------------------------------------------------------------
-- Last owner, member delete
-- ---------------------------------------------------------------------------------------------
select lives_ok($$select pg_temp.add_member((select free from ctx), 1, 'owner')$$, 'free: first owner');
select lives_ok($$select pg_temp.add_member((select free from ctx), 2, 'owner')$$, 'free: second owner');
select lives_ok($$select pg_temp.add_member((select free from ctx), 3, 'manager')$$, 'free: manager');
select lives_ok($$update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000001' and org_id = (select free from ctx)$$, 'one of two owners can be deactivated');
select throws_ok($$update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000002' and org_id = (select free from ctx)$$, 'P0001', 'LAST_OWNER', 'the last owner cannot be deactivated');
select throws_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'manager') where user_id = '00000000-0000-0000-0000-000000000002' and org_id = (select free from ctx)$$, 'P0001', 'LAST_OWNER', 'the last owner cannot be demoted');
select lives_ok($$update public.organization_members set status = 'active', deactivated_at = null where user_id = '00000000-0000-0000-0000-000000000001' and org_id = (select free from ctx)$$, 'reactivate the first owner');
select lives_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'manager') where user_id = '00000000-0000-0000-0000-000000000002' and org_id = (select free from ctx)$$, 'with two owners, one can be demoted');
select throws_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'manager') where user_id = '00000000-0000-0000-0000-000000000001' and org_id = (select free from ctx)$$, 'P0001', 'LAST_OWNER', 'now the other is the last owner');
select throws_ok($$update public.organization_members set user_id = '00000000-0000-0000-0000-000000000009' where user_id = '00000000-0000-0000-0000-000000000003' and org_id = (select free from ctx)$$, 'P0001', 'MEMBER_KEYS_IMMUTABLE', 'a membership cannot be moved to another user');
select throws_ok($$delete from public.organization_members where user_id = '00000000-0000-0000-0000-000000000003' and org_id = (select free from ctx)$$, 'P0001', 'MEMBER_DELETE', 'members are never deleted');
select throws_ok($$delete from public.organization_members where org_id = (select lim from ctx)$$, 'P0001', 'MEMBER_DELETE', 'not even in bulk');

-- ---------------------------------------------------------------------------------------------
-- Escalation (writes that carry auth.uid(), as from a definer RPC). free-org: 1 owner, 2 manager,
-- 3 manager, 5-9 cashiers. Custom role 'Lead' holds pos.use and tables.manage.
-- ---------------------------------------------------------------------------------------------
insert into public.roles (org_id, name) select free, 'Lead' from ctx;
insert into public.role_permissions (role_id, org_id, permission_key)
select r.id, r.org_id, k from public.roles r, unnest(array['pos.use', 'tables.manage']) k where r.name = 'Lead';

-- a member can't change their own role
select pg_temp.uid(3);
select throws_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'cashier') where user_id = '00000000-0000-0000-0000-000000000003' and org_id = (select free from ctx)$$, '42501', 'ESCALATION_DENIED', 'a manager cannot change their own role');
select pg_temp.uid(1);
select throws_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'cashier') where user_id = '00000000-0000-0000-0000-000000000001' and org_id = (select free from ctx)$$, '42501', 'ESCALATION_DENIED', 'not even an owner can change their own role');
-- a manager can't make an Owner, or give what they lack
select pg_temp.uid(3);
select throws_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'owner') where user_id = '00000000-0000-0000-0000-000000000005' and org_id = (select free from ctx)$$, '42501', 'ESCALATION_DENIED', 'a manager cannot make someone Owner');
select throws_ok($$select pg_temp.add_member((select free from ctx), 4, 'owner')$$, '42501', 'ESCALATION_DENIED', 'a manager cannot add an Owner');
select lives_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'waiter') where user_id = '00000000-0000-0000-0000-000000000005' and org_id = (select free from ctx)$$, 'a manager can give a role whose permissions they hold');
select throws_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'billing.manage' from public.roles where name = 'Lead'$$, '42501', 'ESCALATION_DENIED', 'a manager cannot grant billing.manage');
select lives_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'orders.view' from public.roles where name = 'Lead'$$, 'a manager can grant a permission they hold');
select throws_ok($$select pg_temp.invite((select free from ctx), 'boss@example.test', 'owner')$$, '42501', 'ESCALATION_DENIED', 'a manager cannot invite an Owner');
select lives_ok($$select pg_temp.invite((select free from ctx), 'lead@example.test', 'manager')$$, 'a manager can invite a manager');
-- a cashier can't give a role they don't fully hold
select pg_temp.uid(6);
select throws_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'manager') where user_id = '00000000-0000-0000-0000-000000000007' and org_id = (select free from ctx)$$, '42501', 'ESCALATION_DENIED', 'a cashier cannot give the manager role');
select throws_ok($$update public.organization_members set role_id = (select id from public.roles where name = 'Lead') where user_id = '00000000-0000-0000-0000-000000000007' and org_id = (select free from ctx)$$, '42501', 'ESCALATION_DENIED', 'a cashier cannot give a custom role with permissions they lack');
select throws_ok($$select pg_temp.invite((select free from ctx), 'x@example.test', 'manager')$$, '42501', 'ESCALATION_DENIED', 'a cashier cannot invite a manager');
-- a non-member can't give anything
select pg_temp.uid(4);
select throws_ok($$select pg_temp.add_member((select free from ctx), 8, 'cashier')$$, '42501', 'ESCALATION_DENIED', 'a non-member cannot add members');
-- the owner can
select pg_temp.uid(1);
select lives_ok($$update public.organization_members set role_id = pg_temp.role_id(org_id, 'owner') where user_id = '00000000-0000-0000-0000-000000000003' and org_id = (select free from ctx)$$, 'an owner can make another member Owner');
select lives_ok($$insert into public.role_permissions (role_id, org_id, permission_key) select id, org_id, 'billing.manage' from public.roles where name = 'Lead'$$, 'an owner can grant any permission');
select lives_ok($$select pg_temp.invite((select free from ctx), 'owner2@example.test', 'owner')$$, 'an owner can invite an Owner');
-- a deactivated member holds nothing
select set_config('request.jwt.claims', '', true);
update public.organization_members set status = 'deactivated', deactivated_at = now() where user_id = '00000000-0000-0000-0000-000000000003' and org_id = (select free from ctx);
select pg_temp.uid(3);
select throws_ok($$select pg_temp.invite((select free from ctx), 'z@example.test', 'cashier')$$, '42501', 'ESCALATION_DENIED', 'a deactivated actor holds nothing, even a former owner');
-- bootstrap: the creator of a brand-new org may add themself as Owner, nothing else
select set_config('request.jwt.claims', '', true);
insert into public.organizations (name, slug) values ('Fresh one', 'fresh-one'), ('Fresh two', 'fresh-two'), ('Fresh three', 'fresh-three');
insert into public.subscriptions (org_id, package_id, status) select id, (select id from public.packages where key = 'unl'), 'active' from public.organizations where slug like 'fresh-%';
select pg_temp.uid(8);
select lives_ok($$select pg_temp.add_member((select id from public.organizations where slug = 'fresh-one'), 8, 'owner')$$, 'creator becomes Owner of an empty org');
select throws_ok($$select pg_temp.add_member((select id from public.organizations where slug = 'fresh-two'), 8, 'cashier')$$, '42501', 'ESCALATION_DENIED', 'creator cannot take a lesser role in someone else''s empty org');
select throws_ok($$select pg_temp.add_member((select id from public.organizations where slug = 'fresh-three'), 9, 'owner')$$, '42501', 'ESCALATION_DENIED', 'creator cannot add someone else as Owner');
select pg_temp.uid(9);
select throws_ok($$select pg_temp.add_member((select id from public.organizations where slug = 'fresh-one'), 9, 'owner')$$, '42501', 'ESCALATION_DENIED', 'bootstrap works only while the org has no members');
select pg_temp.uid(8);
select lives_ok($$select pg_temp.add_member((select id from public.organizations where slug = 'fresh-one'), 9, 'owner')$$, 'the Owner can add another Owner');
select set_config('request.jwt.claims', '', true);
select lives_ok($$select pg_temp.add_member((select id from public.organizations where slug = 'fresh-two'), 8, 'cashier')$$, 'with no auth.uid() (service_role, migrations) the write is trusted');

-- ---------------------------------------------------------------------------------------------
-- Audit: ids and changed field names only
-- ---------------------------------------------------------------------------------------------
select is((select count(*)::int from public.audit_logs where org_id = (select id from public.organizations where slug = 'fresh-three') and action like 'role%'), 0, 'seeding the five system roles writes no audit rows');
select ok((select count(*) from public.audit_logs where action = 'member.created') > 0, 'member inserts are audited');
select is((select metadata -> 'changed' from public.audit_logs where action = 'member.updated' and metadata ->> 'user_id' = '00000000-0000-0000-0000-000000000003' and org_id = (select lim from ctx) order by created_at limit 1), '["deactivated_at", "status"]'::jsonb, 'the audit row names the changed fields');
select ok((select count(*) from public.audit_logs where action = 'staff_invitation.created') > 0, 'invitations are audited');
select ok((select count(*) from public.audit_logs where action = 'staff_invitation.updated' and metadata -> 'changed' ? 'revoked_at') > 0, 'revoking is audited');
select ok((select count(*) from public.audit_logs where action = 'role.created') = 1, 'a custom role is audited, system roles are not');
select ok((select count(*) from public.audit_logs where action = 'role_permission.created') > 0, 'custom role permissions are audited');
select is((select count(*)::int from public.audit_logs where metadata::text ~ '@|example\.test|person[0-9]'), 0, 'no email or name in any audit metadata');
select is((select count(*)::int from public.audit_logs where action like 'staff_invitation.%' and metadata::text ~* '(token|hash|email)'), 0, 'no token, hash or email key in invitation audit rows');
select is((select actor_id from public.audit_logs where action = 'member.created' and metadata ->> 'user_id' = '00000000-0000-0000-0000-000000000008' and org_id = (select id from public.organizations where slug = 'fresh-one')), '00000000-0000-0000-0000-000000000008'::uuid, 'the actor is auth.uid()');
select is((select actor_id from public.audit_logs where action = 'member.created' and org_id = (select lim from ctx) limit 1), null, 'a write with no auth.uid() has no actor');

-- location_staff is audited, and an org delete still cascades through everything
insert into public.location_staff (member_id, location_id, org_id)
select m.id, l.id, m.org_id from public.organization_members m join public.locations l on l.org_id = m.org_id
where m.org_id = (select lim from ctx) and m.user_id = '00000000-0000-0000-0000-000000000001' limit 1;
select ok((select count(*) from public.audit_logs where action = 'location_staff.created') = 1, 'location staff changes are audited');
select lives_ok($$delete from public.organizations where slug = 'lim2-org'$$, 'deleting an org cascades through members and audit triggers');
select is((select count(*)::int from public.organization_members where org_id not in (select id from public.organizations)), 0, 'no orphan members');

select * from finish();
rollback;
