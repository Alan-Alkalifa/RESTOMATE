# BUG-001: Marketing home throws "Attempted to call buttonClasses() from the server"; hero CTA missing

| | |
|---|---|
| Task ID | MF-T34 (M0-FE-09 Public and platform shells) |
| PR / commit | #65, `a314e0b` (also present on `mf-t51-themed-invitation` `31c0c92`) |
| Severity | S2: the public landing page's one call to action to `/signup` does not render, and every request logs a server error. Workaround: open `/signup` directly |
| Owner (PLAN 1.1) | REYKI |
| Found by / date | DAVIN / 2026-11-24, while building the M0-QA-01 smoke test |
| Environment | local stack, `next dev` (Next 16.4.6), commit `31c0c92`, Chromium 1440x900 |

## Steps
1. `pnpm db:start && pnpm db:reset`, export the local keys, leave `ARCJET_KEY` empty.
2. `pnpm dev`, open `http://localhost:3000/`.
3. Or run `pnpm test:e2e --project=desktop` (the first test in `apps/web/e2e/smoke.e2e.ts`).

## Expected
`/` shows the heading and the hero link to `/signup`.

## Actual
The h1 renders, the `main a[href="/signup"]` link is not found, and the server logs, once per request:

```
⨯ Error: Attempted to call buttonClasses() from the server but buttonClasses is on the client. ...
    at Home (app/(marketing)/page.tsx:18:54)
> 18 |   <Link href="/signup" className={buttonClasses({ variant: "spotlight", size: "lg" })}>
```

Cause (read from the code): `app/(marketing)/page.tsx` is a server component and imports `buttonClasses` from `components/ui/button.tsx`, which starts with `"use client"`. A function exported from a client module cannot be called on the server. The other callers (`components/shell/notices.tsx`, `app/invite/accept/_components/chrome.tsx`, `join-card.tsx`) are client components themselves and are not affected.

Suggested direction (REYKI decides): move `buttonClasses` and its variant table into a module without `"use client"` and re-export it from `button.tsx`.

## Evidence
- Playwright: `smoke.e2e.ts > the marketing page renders` fails: `waiting for locator('main a[href="/signup"]').first()` ... `element(s) not found`. Log: `/tmp/e2e5.log` in the QA sandbox; the failing run is reproduced by step 3.
- Secondary noise from the same request (CARLO, MF-T17, `lib/analytics/server.ts:119`): `Route "/": Next.js encountered the unstable value require('node:crypto').randomUUID() while prerendering`. The error reporter calls `randomUUID()` while a route is prerendering, which Cache Components forbids. It only shows up because the page above throws; if it still appears after the fix, file it separately against MF-T17.

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
