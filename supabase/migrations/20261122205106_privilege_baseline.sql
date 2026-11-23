-- M0-BE-29: explicit-grant baseline. Runs before any application object exists.
--
-- An object that a migration creates in `public` (table, view, sequence, function, procedure) starts
-- with no privilege for anon, authenticated, service_role or PUBLIC. Each migration grants what each
-- role needs, service_role included, next to the object's RLS policies:
--
--   grant select on table public.example to authenticated;
--   grant usage on sequence public.example_seq to service_role;
--   grant execute on function public.example_fn() to authenticated;
--
-- The last statement has no schema on purpose: Postgres grants execute to PUBLIC through a global
-- default, which a revoke limited to one schema can't remove. So it covers functions that postgres
-- creates in every schema. A helper in `private` that a policy calls needs both of these:
--
--   grant usage on schema private to authenticated;
--   grant execute on function private.example_helper() to authenticated;
--
-- This covers objects created by postgres, the role that runs migrations, and only new ones. An
-- extension's objects belong to supabase_admin, whose defaults postgres can't change, so always name
-- a schema that isn't exposed: create extension example with schema extensions;
-- See https://supabase.com/docs/guides/api/securing-your-api (Revoke default privileges).

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

-- `routines` covers functions, aggregates and procedures.
alter default privileges for role postgres in schema public
  revoke all on routines from anon, authenticated, service_role;

alter default privileges for role postgres
  revoke execute on routines from public;
