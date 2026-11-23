# Staging

Real services on a staging environment, before any production work. **Nothing here touches production.** No values appear in this file or in the repo: variable names only.

| Piece | Staging |
|---|---|
| App | Vercel Hobby, project `restomate` (linked to this repo, root directory `apps/web`), `https://restomate-nine.vercel.app` (no custom domain yet) |
| Database + Auth | Supabase project `Restomate-Dev`, ref `byexuyfafpnrcfedubtb`, region ap-southeast-1 (Singapore), created through the Vercel Marketplace |
| Payments | DOKU **sandbox** only (`DOKU_ENV=sandbox`) |
| Email | Resend, `EMAIL_DELIVERY=resend` (production rules apply: `log` is rejected) |

In this Vercel project the **Production** target is staging: a merge to `main` updates staging. It is not the product's production environment, which gets its own project and the project owner's approval. The older Vercel project `restomate-staging` is not staging: don't deploy to it or copy its URLs.

## How a change reaches staging

1. A PR merges to `main`. **CI** runs (lint, typecheck, unit, build, pgTAP, e2e).
2. Vercel builds `main` and deploys the app. The build **fails on a bad or missing server variable** (see *Build and boot checks*).
3. When CI succeeds on that commit, the workflow **Deploy DB (staging)** (`.github/workflows/deploy-db-staging.yml`) deploys the database:
   - It runs only for a successful CI run of a **push** to `main`, or by hand on `main`, never for a pull request or a failed run. Runs are serialized (one migration at a time).
   - The commit must be the tip of `main` **or an ancestor of it**. CI skips docs-only pushes, so a later docs-only push can become the tip before an earlier migration push's CI finishes; that earlier commit still deploys.
   - If staging already has a migration this commit doesn't (a newer deploy already ran), it skips with a notice and stays green. **Never run `supabase migration repair` against staging** without the lead, even if the CLI suggests it.
   - It checks that `SUPABASE_STAGING_DB_URL` is a `postgresql://` URI (no quotes, spaces or line breaks), masks it and its parts (password, host, user, project ref), prints `supabase db push --dry-run`, then applies the pending migrations. It never resets.

Staging went live on 2026-11-23: the first runs applied the 10 M0 migrations and the staging seed.

The app and the database deploy independently. A migration that the new code needs can land slightly after the app; keep migrations backward compatible with the previous app version (add before use, remove in a later release).

## One-time setup (the project owner)

**GitHub, one repository secret** (Settings -> Secrets and variables -> Actions -> New repository secret). Name only:

| Secret | What |
|---|---|
| `SUPABASE_STAGING_DB_URL` | The staging project's **Session pooler** connection string, password included |

Where to copy it: Supabase dashboard -> the `Restomate-Dev` project -> **Connect** -> **Session pooler** (not "Direct connection": that host is IPv6 only and GitHub runners are IPv4). It looks like `postgresql://postgres.byexuyfafpnrcfedubtb:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`. Replace the `[YOUR-PASSWORD]` placeholder with the database password, URL-encoded if it contains special characters (`@` -> `%40`, `#` -> `%23`, `/` -> `%2F`). Paste the finished string into the secret; never into chat, an issue or a file.

**Why only this one (least privilege):** there is deliberately **no** Supabase personal access token. A token is account-wide, so a leaked CI secret would expose every other project in the account. The connection string reaches this one database and nothing else. The workflow stops with an error naming the secret if it is missing, masks the string (and its password on its own) in the logs, and never prints it.

**Supabase Auth on the staging project** (Authentication):
- **URL Configuration:** Site URL `https://restomate-nine.vercel.app`; Redirect URLs `https://restomate-nine.vercel.app/**` and, for deployment, branch and PR preview URLs, `https://*-alan-alkalifas-projects.vercel.app/**` (scope slug `alan-alkalifas-projects`).
- **Email templates:** the hosted project does **not** read `supabase/templates/*.html`. Paste `confirmation.html` into *Confirm sign up* and `recovery.html` into *Reset password*. Without them the confirmation and password-reset links do not work (the app's `/auth/confirm` needs the `token_hash` link they contain).
- **SMTP:** the Resend SMTP settings from CLAUDE.md ("Email (Resend)"). The built-in mailer is rate limited to a handful of mails per hour.

## Environment variables per Vercel environment

Names only. Set them in the Vercel project (Settings -> Environment Variables). A Vercel build and a Vercel runtime both run with `NODE_ENV=production`, so the **production requirements apply to Production and Preview alike**. Development is only for `vercel dev`.

| Variable | Production | Preview | Development | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | required | required | optional | `https://restomate-nine.vercel.app` on Production and Preview |
| `NEXT_PUBLIC_ROOT_DOMAIN` | required | required | optional | same on Production and Preview, bare hostname, no scheme: `restomate-nine.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | required | required | optional | set by the Supabase integration or by hand; must be ref `byexuyfafpnrcfedubtb` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | required | optional | set by the integration or by hand. Accepted as the fallback for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | optional | optional | optional | preferred over `ANON_KEY` when both are set |
| `SUPABASE_SERVICE_ROLE_KEY` | required | required | optional | set by the integration or by hand, from `Restomate-Dev`. Server only |
| `ARCJET_KEY` | required | required | optional | |
| `RESEND_API_KEY` | required | required | optional | |
| `EMAIL_FROM` | required | required | optional | `Restomate <no-reply@mail.restomate.app>`-style sender on a verified Resend domain |
| `EMAIL_DELIVERY` | required: `resend` | required: `resend` | optional | `log` is rejected in production |
| `DOKU_ENV` | `sandbox` | `sandbox` | optional | never `production` on staging |
| `DOKU_CLIENT_ID` | required | required | optional | DOKU **sandbox** credentials |
| `DOKU_SECRET_KEY` | required | required | optional | DOKU **sandbox** credentials |
| `APP_ENCRYPTION_KEY` | required | required | optional | 32 bytes: 64 hex chars or base64. Generate once; changing it makes stored gateway credentials unreadable |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | optional | optional | optional | analytics never blocks the app |

Mark every variable without the `NEXT_PUBLIC_` prefix as **Sensitive** in Vercel.

## Build and boot checks

- **Build (Vercel only):** when `VERCEL=1`, `next build` (not `next dev` or `next typegen`) validates the whole server environment (`next.config.ts` -> `assertVercelBuildEnv`). A bad or missing variable fails the build with `[env] Vercel build blocked. Invalid environment: NAME (reason), ...`. Variable names and reasons only, never values. CI and local builds are unaffected unless `VERCEL=1` is set: `vercel env pull` can write it into `.env.local`, and a local `next build` (so also `pnpm run ci`) then runs this check. Remove that line to build locally.
- **Boot:** `instrumentation.ts` validates the same environment when a production instance starts. If it is invalid the instance fails closed: it logs the names and answers 500. The process does not exit, and static files (`public/`, `/_next/static`) are still served.
- At runtime each module reads only its own slice (email, DOKU, encryption, ...), so one bad slice cannot take down an unrelated path.

## Seed data (optional, manual)

Run the workflow **Deploy DB (staging)** by hand (Actions -> Run workflow, branch `main`) and tick **apply_seed**. It runs `supabase/seed-staging.sql` after the migrations with `psql "$SUPABASE_STAGING_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f ...` (all or nothing). `psql` rather than the Supabase CLI because `supabase db query -f` sends a file as one prepared statement, which cannot hold a multi-command seed.

- It creates the packages (placeholder prices) and the **Demo Restaurant** (`demo`): subscription, roles, two locations, areas, tables, menu, overrides.
- It creates **no** auth users, passwords, identities, platform admins, members or other tenants. Table QR tokens are random.
- It is idempotent and only inserts; re-running changes nothing. It is never applied automatically.
- The local `supabase/seed.sql` (with its shared local-only password) is never used on staging.
- Check: `bash apps/web/scripts/check-staging-seed.sh` against a local `supabase start` (runs the seed twice on a migrations-only database and asserts the above).

## Bootstrapping the first platform admin

Nobody is a platform admin on a fresh staging database, and the app has no way to create one (by design: `platform_admins` has no client access).

1. The person signs up on staging and confirms their email, so a row exists in `auth.users`.
2. The lead asks the project owner to approve **one** `INSERT`. After approval, run it in the Supabase SQL editor of the **staging** project only. Replace the placeholder with the person's real address in the editor; do not commit it:

```sql
-- STAGING ONLY. Not run by any workflow or script.
insert into public.platform_admins (user_id)
select id from auth.users
where email = '<their sign-up email>'
on conflict (user_id) do nothing;

-- Verify (expect one row):
select user_id from public.platform_admins;
```

3. Sign out and in again; `/admin` now opens for that user. Other admins are added the same way, one approval each.

To remove an admin: `delete from public.platform_admins where user_id = '<uuid>';` (same approval rule).

## Rollback

**Migrations are forward-only.** There is no automatic down migration and the workflow never resets the database. To undo a bad migration, write a **new** migration that reverses it and let it deploy the normal way. Never edit a migration that already ran on staging (it will not run again, and the history check will complain). For a bad application release, use Vercel's instant rollback to the previous deployment; the database stays as it is, which is why migrations must stay backward compatible.

If staging data is hopeless, the owner can reset the project in the Supabase dashboard; the next workflow run re-applies every migration, and the seed can be applied again.

## Known limits

- Production staging URL only for tenant/custom hosts: any host that is not the app/root domain 404s in production.

## Preview deployments (M0-BE-14)

`proxy.ts` treats unknown hosts as unknown tenants (404). On a Vercel **preview** deployment (`VERCEL_ENV=preview` only) the deployment's own hosts, `VERCEL_URL` and `VERCEL_BRANCH_URL`, are served as the app host, so PR preview URLs work (e.g. `/login`). Hosts come from Vercel system env vars, never a request header, and only exact `*.vercel.app` hostnames are accepted. Production is unchanged.

- Vercel project, Settings, Environment Variables: **"Automatically expose System Environment Variables" must be ON** (provides `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`).
- `turbo.json` needs no change: the proxy reads these at runtime.
- Supabase Auth redirect URLs must include the preview pattern above, or sign-in on a preview will bounce.
- A direct call to Supabase Auth's `/signup` with the public key can create an account while sign-ups are switched off in platform settings; such an account still cannot create an organization (closed by M1-BE-08).
