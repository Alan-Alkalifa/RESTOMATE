-- M0-QA-01: pins the explicit-grant baseline (M0-BE-29).
-- A new table, view, sequence, function and procedure created by postgres (the role that runs
-- migrations) is unreachable for anon, authenticated, service_role and PUBLIC until a migration grants
-- it. If a future migration, a Supabase CLI upgrade or a hosted default brings the old defaults back,
-- this file fails.
begin;
select plan(42);

-- Objects exactly as a migration would create them, in public and in private.
create table public.qa_baseline_table (id int primary key);
create view public.qa_baseline_view as select 1 as one;
create sequence public.qa_baseline_seq;
create function public.qa_baseline_fn() returns int language sql as 'select 1';
create procedure public.qa_baseline_proc() language sql as 'select 1';
create function private.qa_baseline_private_fn() returns int language sql as 'select 1';

-- 1. Default privileges: no API role and no PUBLIC entry for postgres in public.
select is(
  (select count(*)::int
   from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
  0,
  'default privileges of postgres in public grant nothing to PUBLIC or API roles'
);
select is(
  (select count(*)::int
   from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 0
     and d.defaclobjtype = 'f'
     and a.grantee = 0),
  0,
  'global default does not grant execute on functions to PUBLIC'
);

-- 2. Every object has an ACL with only its owner on it (a null function ACL would mean PUBLIC execute).
select is(
  (select count(*)::int from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.qa_baseline_table'::regclass and a.grantee <> c.relowner),
  0, 'table: only the owner holds a privilege'
);
select is(
  (select count(*)::int from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.qa_baseline_view'::regclass and a.grantee <> c.relowner),
  0, 'view: only the owner holds a privilege'
);
select is(
  (select count(*)::int from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.qa_baseline_seq'::regclass and a.grantee <> c.relowner),
  0, 'sequence: only the owner holds a privilege'
);
select ok(
  (select proacl is not null from pg_proc where oid = 'public.qa_baseline_fn()'::regprocedure),
  'function in public: ACL is explicit, not the PUBLIC-execute default'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.qa_baseline_fn()'::regprocedure and a.grantee <> p.proowner),
  0, 'function in public: only the owner may execute'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.qa_baseline_proc()'::regprocedure and a.grantee <> p.proowner),
  0, 'procedure in public: only the owner may execute'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'private.qa_baseline_private_fn()'::regprocedure and a.grantee <> p.proowner),
  0, 'function in private: only the owner may execute'
);

-- 3. Each role, each privilege.
do $$
declare
  r text;
  p text;
begin
  perform set_config('qa.dummy', '1', true);
  for r in select unnest(array['anon', 'authenticated', 'service_role']) loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.qa_baseline_table', p) then
        raise exception 'BASELINE BROKEN: % has % on a new table', r, p;
      end if;
    end loop;
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(r, 'public.qa_baseline_view', p) then
        raise exception 'BASELINE BROKEN: % has % on a new view', r, p;
      end if;
    end loop;
    foreach p in array array['usage', 'select', 'update'] loop
      if has_sequence_privilege(r, 'public.qa_baseline_seq', p) then
        raise exception 'BASELINE BROKEN: % has % on a new sequence', r, p;
      end if;
    end loop;
  end loop;
end $$;

select ok(not has_table_privilege('anon', 'public.qa_baseline_table', 'select'), 'anon cannot select a new table');
select ok(not has_table_privilege('anon', 'public.qa_baseline_table', 'insert'), 'anon cannot insert into a new table');
select ok(not has_table_privilege('authenticated', 'public.qa_baseline_table', 'select'), 'authenticated cannot select a new table');
select ok(not has_table_privilege('authenticated', 'public.qa_baseline_table', 'insert'), 'authenticated cannot insert into a new table');
select ok(not has_table_privilege('service_role', 'public.qa_baseline_table', 'select'), 'service_role cannot select a new table');
select ok(not has_table_privilege('service_role', 'public.qa_baseline_table', 'insert'), 'service_role cannot insert into a new table');
select ok(not has_table_privilege('anon', 'public.qa_baseline_view', 'select'), 'anon cannot select a new view');
select ok(not has_table_privilege('authenticated', 'public.qa_baseline_view', 'select'), 'authenticated cannot select a new view');
select ok(not has_table_privilege('service_role', 'public.qa_baseline_view', 'select'), 'service_role cannot select a new view');
select ok(not has_sequence_privilege('anon', 'public.qa_baseline_seq', 'usage'), 'anon cannot use a new sequence');
select ok(not has_sequence_privilege('authenticated', 'public.qa_baseline_seq', 'usage'), 'authenticated cannot use a new sequence');
select ok(not has_sequence_privilege('service_role', 'public.qa_baseline_seq', 'usage'), 'service_role cannot use a new sequence');
select ok(not has_function_privilege('anon', 'public.qa_baseline_fn()', 'execute'), 'anon cannot execute a new function');
select ok(not has_function_privilege('authenticated', 'public.qa_baseline_fn()', 'execute'), 'authenticated cannot execute a new function');
select ok(not has_function_privilege('service_role', 'public.qa_baseline_fn()', 'execute'), 'service_role cannot execute a new function');
select ok(not has_function_privilege('anon', 'public.qa_baseline_proc()', 'execute'), 'anon cannot execute a new procedure');
select ok(not has_function_privilege('authenticated', 'public.qa_baseline_proc()', 'execute'), 'authenticated cannot execute a new procedure');
select ok(not has_function_privilege('service_role', 'public.qa_baseline_proc()', 'execute'), 'service_role cannot execute a new procedure');
select ok(not has_function_privilege('anon', 'private.qa_baseline_private_fn()', 'execute'), 'anon cannot execute a new function in private');
select ok(not has_function_privilege('authenticated', 'private.qa_baseline_private_fn()', 'execute'), 'authenticated cannot execute a new function in private');
select ok(not has_function_privilege('service_role', 'private.qa_baseline_private_fn()', 'execute'), 'service_role cannot execute a new function in private');

-- 4. The same through the API roles themselves: a real call fails with insufficient_privilege (42501).
set local role anon;
select throws_ok('select * from public.qa_baseline_table', '42501', null, 'anon: select on a new table is denied');
select throws_ok('select public.qa_baseline_fn()', '42501', null, 'anon: calling a new function is denied');
reset role;

set local role authenticated;
select throws_ok('select * from public.qa_baseline_table', '42501', null, 'authenticated: select on a new table is denied');
select throws_ok('select * from public.qa_baseline_view', '42501', null, 'authenticated: select on a new view is denied');
select throws_ok('select nextval(''public.qa_baseline_seq'')', '42501', null, 'authenticated: nextval on a new sequence is denied');
select throws_ok('select public.qa_baseline_fn()', '42501', null, 'authenticated: calling a new function is denied');
select throws_ok('call public.qa_baseline_proc()', '42501', null, 'authenticated: calling a new procedure is denied');
reset role;

set local role service_role;
select throws_ok('select * from public.qa_baseline_table', '42501', null, 'service_role: select on a new table is denied');
select throws_ok('select public.qa_baseline_fn()', '42501', null, 'service_role: calling a new function is denied');
reset role;

-- 5. An explicit grant is what opens the door, and only for the role named.
grant select on table public.qa_baseline_table to authenticated;
select ok(has_table_privilege('authenticated', 'public.qa_baseline_table', 'select'), 'after an explicit grant authenticated can select');
select ok(not has_table_privilege('anon', 'public.qa_baseline_table', 'select'), 'the grant did not reach anon');
select ok(not has_table_privilege('service_role', 'public.qa_baseline_table', 'select'), 'the grant did not reach service_role');

select * from finish();
rollback;
