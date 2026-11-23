# Auth contract

Sign-in, sign-up, password reset, sign-out; the `/auth/confirm` route; the email links; and the
access layer (`lib/auth`) that every page and action uses to decide who someone is and what they may
see. Result and code conventions are in [README.md](./README.md).

> Status: final. Matches the merged code (M0-BE-20: #42, M0-BE-15: #39) and M0-BE-31
> (`resendConfirmation`, `signOut({ next })`, the `next` kept for the confirmation email).

## Pages the frontend owns

| Path               | Shows                      | Query                                                      | Notes                                                                                                                                |
| ------------------ | -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/login`           | Login form                 | `next` (a path), `error` (`invalid_link` \| `unavailable`) | Signed-in users skip it (see "Pages for signed-out users").                                                                          |
| `/signup`          | Sign-up form (root domain) | `next`                                                     | Same skip. The sign-up page name is the frontend's; only `/login`, `/forgot-password` and `/reset-password` are fixed by the server. |
| `/forgot-password` | Request a reset email      | `error` (`invalid_link` \| `unavailable`)                  | Same skip.                                                                                                                           |
| `/reset-password`  | Choose a new password      | none                                                       | Needs the session the recovery link created. Without one, send to `/forgot-password`.                                                |

`next` is user input. Pass it through to the action as given; the server reduces it to a safe
same-site path (see "`next`"). Never build a redirect from it yourself.

Constants (import from `@/lib/auth`): `LOGIN_PATH` (`/login`), `FORGOT_PASSWORD_PATH`,
`RESET_PASSWORD_PATH`, `DEFAULT_AFTER_LOGIN` (`/app`), `loginUrl(next?)`, `safeNextPath(raw, fallback?)`.

## Actions

Import from `@/lib/actions/auth/actions`; schemas and types from `@/lib/actions/auth/schemas`.
All are Server Actions. Each one validates with the shared schema first, is rate-limited before
anything else is asked, and returns one `ActionResult` (or redirects).

### `login(input)`

| Field      | Type             | Rules                                                                                        |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `email`    | string           | Trimmed, lower-cased, a valid address, at most 254 characters. Blank: `auth.field.required`. |
| `password` | string           | Required, at most 1024 characters. The password policy is **not** applied here.              |
| `next`     | string, optional | Reduced to a safe path; anything unsafe becomes `/app`.                                      |

- **Success:** redirects to the safe `next` (default `/app`). No `ok` result.
- **Already signed in:** redirects the same way, without signing in again.
- **Errors:** `validation` (`email`, `password`), `rate_limited`, `forbidden` (blocked as a bot),
  `invalid_credentials`, `email_not_confirmed`, `unavailable`, `unknown`.
- **Rate limit:** 60 per IP and 5 per email, each per 15 minutes (the IP limit is loose on purpose: a
  venue's tablets share one address).

### `signup(input)`

| Field      | Type                       | Rules                                                                                                                     |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `email`    | string                     | As login. A disposable or invalid address is refused: `validation`, `email: ["auth.email.rejected"]`.                     |
| `password` | string                     | 8 to 72 **bytes**: `auth.password.too_short`, `auth.password.too_long`. A password Auth finds weak: `auth.password.weak`. |
| `fullName` | string, optional           | Trimmed, at most 120 characters (`auth.full_name.too_long`). Blank means no name. Stored on the profile.                  |
| `locale`   | `"en"` \| `"id"`, optional | Anything else is ignored (default `en`). Stored on the profile.                                                           |
| `next`     | string, optional           | As login. Also kept for the confirmation email (see below).                                                               |

- **Success:** `ok({ status: "confirmation_sent" })`: show "check your email". If the project has email
  confirmation switched off, the user is signed in and it redirects instead (like login).
- **The answer is the same for every address.** A new address, an unconfirmed one and one that
  already has an account all return `ok({ status: "confirmation_sent" })`, with no cookie and no
  difference in the response. Never write "this email is already registered".
- **`next` through the confirmation email.** When `next` is a safe same-site path it is stored in the
  user's metadata as `next`, so the confirmation link can bring the person back (for example to an
  invitation: `/invite/accept?token=...`). An unsafe or missing `next` is **never stored** and the
  answer is exactly the same. See "Email links" for the template.
- **Errors:** `validation`, `rate_limited`, `forbidden`, `unavailable`, `unknown`.
- **Rate limit:** 5 per IP and 3 per email, each per hour.

### `requestPasswordReset(input)`

| Field   | Type   | Rules     |
| ------- | ------ | --------- |
| `email` | string | As login. |

- **Success:** `ok()`: always show "if that address has an account, we sent a link". Also for an
  unknown address.
- **Errors:** `validation`, `rate_limited`, `forbidden`, `unavailable`. Nothing else is reported, so
  the form can't be used to find accounts.
- **Rate limit:** 5 per IP and 3 per email, each per hour.
- Signed-in users skip the page and the action redirects them to `/app`.

### `resendConfirmation(input)`

For the "I didn't get the email" button after sign-up, and for `email_not_confirmed` at login.

| Field   | Type   | Rules    |
| ------- | ------ | -------- |
| `email` | string | As login |

- **Success:** `ok()`: always show "if that address needs confirming, we sent a new link". The
  answer, the response headers and the cookies are **the same for an unknown address, an unconfirmed
  one and a confirmed one** (a cookie-free client, like sign-up). Never say whether the address has
  an account.
- **Errors:** `validation`, `rate_limited`, `forbidden`, `unavailable`. Nothing else is reported.
- **Rate limit:** 5 per IP and 3 per email, each per hour. Show a short wait before offering it
  again; a quick repeat is `rate_limited`.
- Signed-in users skip the page, and the action redirects them to `/app`.
- The new email has the same link as the first one (see "Email links").

### `resetPassword(input)`

| Field             | Type   | Rules                                                                 |
| ----------------- | ------ | --------------------------------------------------------------------- |
| `password`        | string | As signup.                                                            |
| `confirmPassword` | string | Must equal `password`: `confirmPassword: ["auth.password.mismatch"]`. |

- Needs the session the recovery link created (see `/auth/confirm`).
- **Success:** the password is changed, **every other session of the account is ended**, and it
  redirects to `/app`. This session stays signed in.
- **Errors:** `validation` (also `password: ["auth.password.same_as_old"]`, `auth.password.weak`),
  `unauthenticated` (no recovery session: send to `/forgot-password`), `rate_limited`, `unavailable`.
- **Rate limit:** per IP only, 60 per 15 minutes.

### `signOut(input?)`

| Field  | Type             | Rules                                                       |
| ------ | ---------------- | ----------------------------------------------------------- |
| `next` | string, optional | A safe same-site path; anything else is ignored (no `next`) |

Ends **this** session only (other devices stay signed in), clears the auth cookies even if Auth
can't be reached, and redirects to `/login`, or to `/login?next=<path>` when a safe `next` is sent.
That is how "sign out and use the invited address" returns to the invitation link after the next
sign-in (`next` = `/invite/accept?token=...`).

- Never rate-limited and never refused by the action. (The proxy's bot and shield rules can still
  refuse a non-browser client.)

## Route: `GET /auth/confirm`

The target of the links in the emails. It verifies the link, which signs the user in, and sends them on.

| Query        | Rules                                                |
| ------------ | ---------------------------------------------------- |
| `token_hash` | Required, 8 to 512 characters.                       |
| `type`       | `signup` \| `email` \| `recovery` \| `email_change`. |
| `next`       | Optional path; reduced to a safe same-site path.     |

- **Success:** `303` to `/reset-password` for `type=recovery` (whatever `next` says); otherwise to
  the safe `next`, default `/app`.
- **Failure:** `303` back to the page the link belongs to with a code, never a message:
  `/forgot-password?error=invalid_link` for `recovery`, `/login?error=invalid_link` for the rest. A
  bad, expired or used link is `invalid_link`; Auth being unreachable is `unavailable`.
  `/login` and `/forgot-password` read `error` and show the matching text (and, for `invalid_link`,
  a way to ask again).
- The redirect stays on the host that received the request (already checked by the proxy). It never
  leaves the site.

## Email links (for M0-FE-10)

The Supabase Auth templates use the **Site URL** and the token hash. They never use a redirect host
from a caller, and never `{{ .ConfirmationURL }}` (that is the PKCE link, which these flows don't use).

| Email           | Link                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| Confirm sign up | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`       |
| Reset password  | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`     |
| Change email    | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change` |

**Sign-up carries `next`.** The confirm-sign-up template ends with `&next={{ .Data.next }}`, the
`next` that `signup` stored in the user's metadata (URL-encoded where the template engine does not do
it for you: check the rendered link in Mailpit). It **works when empty**: no `next` stored means
`&next=` and the confirm route falls back to `/app`. The route re-checks it (`safeNextPath`) whatever
the email says, so it can never leave the site.

Add `&next=/some/path` to another template where it needs to land somewhere other than `/app`. A staff
invitation is **not** a Supabase Auth email: see [staff.md](./staff.md) for its link. The hosted
project does not read `supabase/templates/*.html`; the templates are pasted into the dashboard.

## `next`

A same-site absolute path only: it starts with a single `/`, has no scheme or host, no `//`, no
backslash, no control character, and is at most 512 characters, also after decoding. Anything else
becomes the fallback (`/app`). The server applies this on every redirect; a form passes `next`
through unchanged.

## The access layer (`@/lib/auth`)

Pages, actions and route handlers decide access with these and nothing else. `proxy.ts` never
authorizes. All of them read cookies, so call them **inside `<Suspense>`** (Cache Components); a
page that does not wait for the user has no business showing user data.

| Function                                            | Returns                                        | Use                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCurrentUser()`                                  | `{ id, email } \| null \| "unavailable"`       | `null` = no valid session. `"unavailable"` = Auth could not be reached in time: **not** signed out.                                                                     |
| `requireUser({ next? })`                            | the user                                       | Redirects to `loginUrl(next)` when signed out. **Throws `AuthUnavailableError`** during an outage (show the error screen; do not redirect to a login that cannot work). |
| `getOrgContext({ orgId } \| { slug })`              | `{ ok: true, ctx }` or `{ ok: false, reason }` | One call per page or action in an org.                                                                                                                                  |
| `requirePermission(ctx, key)`                       | `ActionResult`                                 | `forbidden` when the member lacks the permission.                                                                                                                       |
| `hasPermission(ctx, key)`                           | boolean                                        | Show or hide a control. Never the only check.                                                                                                                           |
| `requireFeature(ctx, key)` / `hasFeature(ctx, key)` | `ActionResult` / boolean                       | The org's package. No package, no feature.                                                                                                                              |
| `requirePlatformAdmin()`                            | `ActionResult<{ userId }>`                     | `/admin`. Never cached, never redirects.                                                                                                                                |

`ctx` is `{ user, org: { id, slug, name }, member: { id, roleId, roleKey, roleName }, permissions: ReadonlySet<string>, package: OrgPackage | null }`.
The Owner holds every permission. `OrgPackage.features` is a map of feature key to boolean; limits
(`max_locations`, `max_staff`, `max_tables`) are numbers, `null` meaning unlimited.

### What a page shows for each answer

| `getOrgContext` reason | Page                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `unauthenticated`      | Redirect to `loginUrl(<this path>)`.                                      |
| `no_membership`        | 404 (the same for an unknown org, another tenant's org and a non-member). |
| `org_suspended`        | The suspended notice. No org data.                                        |
| `member_deactivated`   | The access-removed notice.                                                |
| `unavailable`          | The error screen with retry. Never a login redirect.                      |

For `requirePlatformAdmin`: `unauthenticated` → login, `not_platform_admin` → 404, `unavailable` →
the error screen.

Permission keys: `menu.manage`, `orders.view`, `orders.create`, `orders.void`, `pos.use`,
`pos.discount`, `kitchen.view`, `kitchen.update`, `tables.view`, `tables.manage`,
`reservations.view`, `reservations.manage`, `bills.print`, `payments.view`, `payments.take`,
`payments.refund`, `customers.view`, `customers.manage`, `reports.view`, `staff.manage`,
`locations.manage`, `settings.manage`, `settings.branding`, `billing.manage`.
Feature keys: `online_payments`, `reservations`, `customers`, `custom_roles`, `staff_schedules`,
`advanced_reports`, `csv_export`, `theme_customization`, `custom_domain`, `loyalty`.
(`PERMISSION_KEYS`, `FEATURE_KEYS` in `@/lib/auth`.)

### Access is checked again on every request

Membership, role and permissions are re-read for every request in production; a cached answer is
never kept across requests there. A deactivated member, a changed role or a suspended org takes
effect on the next request, and a deactivated member's sessions are also ended. Do not cache "this
user may" in the browser.

### `OrgPackage` (`ctx.package`): exact fields

For "x of y seats", the plan-limit states and the trial banner. `ctx.package` is `null` when the org has
no running subscription (no package, so no feature, and every limit is 0).

| Field                 | Type                          | Meaning                                                                                                                                                                       |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package_key`         | string                        | The plan's key (stable; use it for logic).                                                                                                                                    |
| `package_name`        | string                        | The plan's display name.                                                                                                                                                      |
| `subscription_status` | string                        | `trialing`, `active` or `past_due` (the only statuses with a package).                                                                                                        |
| `trial_ends_at`       | string (ISO 8601) \| null     | End of the trial; null when not trialing. Show the trial banner while `trialing`.                                                                                             |
| `current_period_end`  | string (ISO 8601) \| null     | End of the paid period.                                                                                                                                                       |
| `max_locations`       | number \| null                | Limit; **null means unlimited**.                                                                                                                                              |
| `max_staff`           | number \| null                | Limit on active members **plus open invitations**; null = unlimited. "x of y seats".                                                                                          |
| `max_tables`          | number \| null                | Limit (used from M2); null = unlimited.                                                                                                                                       |
| `features`            | `Record<FeatureKey, boolean>` | Keys: `online_payments`, `reservations`, `customers`, `custom_roles`, `staff_schedules`, `advanced_reports`, `csv_export`, `theme_customization`, `custom_domain`, `loyalty`. |

Used seats come from the data you already read: active members from `listMembers` plus open
invitations from `listInvitations`. A full limit shows up as `feature_unavailable` with
`staff.plan_limit.staff` (or `org.plan_limit.locations`) when an action is refused: show the upgrade
path there too, not only in the banner.

### A page without the permission: a notice, not a 404

A signed-in member who lacks the permission a page needs (`hasPermission(ctx, key)` is false) sees a
"you can't do this" notice **inside the shell**, and the nav entry for that page is **hidden**. It is
**not** a 404: 404 is only for `no_membership` (the org doesn't exist for them). The action behind the
page still answers `forbidden` if it is called anyway.

## Message keys

`auth.field.required`, `auth.field.invalid` (anything else wrong with a field),
`auth.email.invalid`, `auth.email.rejected` (a disposable or invalid address at sign-up),
`auth.password.too_short`, `auth.password.too_long`, `auth.password.mismatch`,
`auth.password.weak`, `auth.password.same_as_old`, `auth.full_name.too_long`.

Which field carries which: `email` → `auth.field.required`, `auth.email.invalid`, `auth.email.rejected`;
`password` → `auth.field.required`, `auth.password.too_short`, `auth.password.too_long`,
`auth.password.weak`, `auth.password.same_as_old`; `confirmPassword` → `auth.password.mismatch`;
`fullName` → `auth.full_name.too_long`. Codes without a key: `invalid_credentials`,
`email_not_confirmed`, `invalid_token`, `rate_limited`, `unavailable`, `unknown` (the screen's text
comes from the code).

## Cache tags

None of the auth actions refresh a tag. The actions that change membership (organization and staff)
refresh `user:<userId>:memberships` and `org:<orgId>:member:<userId>`; see their files. Tags hold
IDs only.
