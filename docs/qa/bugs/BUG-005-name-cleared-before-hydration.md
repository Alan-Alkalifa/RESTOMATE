# BUG-005 (S4, dev only): the restaurant name typed before hydration is cleared in `next dev`

| | |
|---|---|
| Task ID | MF-T30 (M0-FE-05 Create restaurant, #61: `app/(onboarding)/_components/create-restaurant-form.tsx`) |
| PR / commit | stack top `d09f495` |
| Severity | **S4**: reproduces in `next dev`, not in a production build (12 of 12 attempts kept the text, at 6x and 20x CPU throttle). It would be S3 (it loses input) if it showed in production. Planned for M1 (ALAN), no fix on #61 now |
| Owner (PLAN 1.1) | REYKI |
| Found by / date | DAVIN / 2026-11-24, during the T39 journey (the name field showed "This field is required." after it had been filled) |

## Steps
1. Log in as a user without a restaurant. Load `/create-restaurant`.
2. As soon as the "Restaurant name" field exists in the page, type a name (before the client has hydrated the form).
3. Wait a few seconds and read the field.

## Expected
The typed name is still there.

## Actual
In `next dev` the field is empty again after hydration, and the form shows "This field is required." The slug field, which the test typed later (after the slug check answered), kept its value.

## Evidence
`apps/web/e2e/hydration-race.e2e.ts` (off by default; `E2E_HYDRATION_RACE=1 CPU_RATE=<n> E2E_BASE_URL=<url> pnpm test:e2e hydration-race --project=desktop`): 6 page loads per run, CPU throttled through the DevTools protocol, the name filled right after the response commits, read back after 5 s.

| Server | CPU throttle | Attempts that lost the name |
|---|---|---|
| `next dev` (control) | 6x | **2 of 6** (`["","QA Race Restaurant","","QA Race Restaurant","QA Race Restaurant","QA Race Restaurant"]`) |
| `next build` + `next start` | 6x | 0 of 6 |
| `next build` + `next start` | 20x | 0 of 6 |

The control run shows the check can see the problem. The production runs used the build of the stack top (`pnpm run build` with the local Supabase variables), `next start` on port 3100, and placeholder production settings (the app refuses to boot in production mode without them).

## Not verified
- A real device, a real network, or a Vercel preview. Only emulated CPU throttling on one machine, 12 production attempts in total. Zero in 12 is good evidence, not proof.
- Why the production build keeps the text (hydration timing of a controlled input is the likely cause); not traced.
- The T39 journey avoids it by waiting for the slug check before typing the name.

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
