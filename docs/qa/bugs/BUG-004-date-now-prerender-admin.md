# BUG-004 (Deferred to M1, S4): `next dev` logs "unstable value Date.now() while prerendering" for /app and /app/[slug]

| | |
|---|---|
| Task ID | MF-T31 (M0-FE-06 Admin shell), to be confirmed by REYKI: the stack points at `OrgLayout` (`app/(admin)/app/[slug]/layout.tsx`); the actual `Date.now()` caller was not traced |
| PR / commit | stack top `d09f495` |
| Status | **Deferred to M1, S4** (ALAN, 2026-11-24; backlog task on board B1). Does not block T39 or the M0 sign-off unless it shows on a preview or production build |
| Severity | S4 pending triage: pages render and every e2e passes; seen in `next dev` only. Raise it if the same error shows in `next build` or `next start` |
| Owner (PLAN 1.1) | REYKI |
| Found by / date | DAVIN / 2026-11-24, in the server log of the `app-chooser` e2e |

## Steps
1. Local stack up, `pnpm test:e2e app-chooser` (or log in as a user with restaurants, open `/app` and `/app/<slug>`).
2. Read the web server output.

## Expected
No Cache Components error.

## Actual
`Error: Route "/app": Next.js encountered the unstable value Date.now() while prerendering` and the same for `Route "/app/[slug]"` (`at OrgLayout (app/(admin)/app/[slug]/layout.tsx:67:7)`), several times per run. Next's message: render it at request time after a dynamic access, cache it, or compute it on the client.

## Stack as printed (full, from the T39 run on `d09f495`)
Next prints a component stack only, not a call stack, so there is no non-framework frame below it to quote:

```
⨯ Error: Route "/app/[slug]": Next.js encountered the unstable value `Date.now()` while prerendering.
  This value can change between renders, so it must be either prerendered or computed later.
  Ways to fix this: [dynamic] await connection() before this call · [cache] "use cache" ·
  [client] "use client" · [measure] performance.now() for telemetry.
  Learn more: https://nextjs.org/docs/messages/blocking-prerender-current-time
    at OrgLayout (app/(admin)/app/[slug]/layout.tsx:67:7)
  65 |   return (
  66 |     <Suspense fallback={<ShellLoading />}>
> 67 |       <ShellFor params={params}>{children}</ShellFor>
     |       ^
  68 |     </Suspense>
  69 |   );
  70 | }
  digest: '1132706797'
```
The same message appears for `Route "/app"` and `Route "/create-restaurant"` (all three are routes that read the signed-in user). The frame names the Suspense boundary that wraps the dynamic part, which matches ALAN's and REYKI's reading that the clock read is below it, probably `supabase.auth.getClaims()` under `getCurrentUser()`. Not traced further (no debugger or `--enable-source-maps` run).

## Evidence
Web server output of two full e2e runs (desktop and tablet), same lines each time. The `randomUUID` error that appeared next to BUG-001 earlier no longer shows (BUG-002 not needed).

## Not verified
Whether it shows in a production build or a Vercel preview, and who calls `Date.now()` (the code under the layout, or a library such as the Supabase client).

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
