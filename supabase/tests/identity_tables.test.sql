-- M0-BE-05: identity tables are closed to clients except a user's own profile.
begin;
select plan(32);

-- RLS on and the tables exist
select has_table('public'::name, t::name) from unnest(array['profiles','platform_admins','platform_settings','audit_logs']) t;
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.platform_admins'::regclass), 'platform_admins has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.platform_settings'::regclass), 'platform_settings has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_logs'::regclass), 'audit_logs has RLS');

-- Two users; the signup trigger creates their profiles
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '{"full_name":"User A","locale":"id"}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '{}');

select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'User A', 'profile synced from auth.users');
select is((select locale from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'id', 'locale synced');
select is((select locale from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'en', 'locale defaults to en');

update auth.users set email = 'a2@example.test' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select email from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'a2@example.test', 'email change synced');

-- Seed rows as the owner
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.platform_settings (key, value) values ('signup.enabled', 'true');
insert into public.audit_logs (action) values ('seed');

-- anon: nothing
set local role anon;
select throws_ok($$select 1 from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select 1 from public.platform_admins$$, '42501', null, 'anon cannot read platform_admins');
select throws_ok($$select 1 from public.platform_settings$$, '42501', null, 'anon cannot read platform_settings');
select throws_ok($$select 1 from public.audit_logs$$, '42501', null, 'anon cannot read audit_logs');
select throws_ok($$insert into public.audit_logs (action) values ('x')$$, '42501', null, 'anon cannot write audit_logs');
reset role;

-- authenticated user A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'a user sees only their own profile');
select is((select id from public.profiles), '00000000-0000-0000-0000-0000000000a1'::uuid, 'and it is theirs');
select lives_ok($$update public.profiles set full_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a1'$$, 'user can edit own name');
select throws_ok($$update public.profiles set email = 'evil@example.test' where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'user cannot edit email');
select lives_ok($$update public.profiles set full_name = 'Hijack' where id = '00000000-0000-0000-0000-0000000000b2'$$, 'updating another profile is a no-op');
select throws_ok($$insert into public.profiles (id) values (gen_random_uuid())$$, '42501', null, 'user cannot insert profiles');
select throws_ok($$delete from public.profiles$$, '42501', null, 'user cannot delete profiles');

select throws_ok($$select 1 from public.platform_admins$$, '42501', null, 'authenticated cannot read platform_admins');
select throws_ok($$insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000b2')$$, '42501', null, 'authenticated cannot make an admin');
select throws_ok($$select 1 from public.platform_settings$$, '42501', null, 'authenticated cannot read platform_settings');
select throws_ok($$update public.platform_settings set value = 'false'$$, '42501', null, 'authenticated cannot write platform_settings');
select throws_ok($$insert into public.audit_logs (action) values ('x')$$, '42501', null, 'authenticated cannot write audit_logs');
reset role;
select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), null, 'another profile is unchanged');

-- service_role: what it needs, and audit_logs stays append-only
set local role service_role;
select lives_ok($$insert into public.audit_logs (action) values ('ok')$$, 'service_role appends audit rows');
select throws_ok($$delete from public.audit_logs$$, '42501', null, 'service_role cannot delete audit rows');
reset role;

select * from finish();
rollback;
