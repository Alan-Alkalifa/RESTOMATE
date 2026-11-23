# Organization contract

Check that a restaurant address (slug) is free, create a restaurant with its first location, and the
reads the `/app` page, the org switcher and the create page need.
Result and code conventions are in [README.md](./README.md); the signed-in rules are in
[auth.md](./auth.md).

> Status: final. Matches the merged code (M0-BE-21: #44) and M0-BE-31 (`listMyOrganizations`,
> `listLocations`).

Import from `@/lib/actions/organization/actions`; schemas, limits and types from
`@/lib/actions/organization/schemas` (safe in a client component).

`checkSlug` and `createOrganization` need a **signed-in user** and no org permission (the user has no
org yet), and are rate-limited per user and per IP before the database is asked.
`listMyOrganizations` and `listLocations` are plain reads (below).

## `checkSlug(slug)`

Used live while someone types the address of their customer site (`<slug>.<root domain>`). Debounce it.

| Input  | Type   | Rules                                                                                                                                                                  |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug` | string | Trimmed of **spaces only** and lower-cased, as the database does. Then: 3 to 40 characters, `a-z`, `0-9` and hyphens, starts and ends with a letter or digit, no `--`. |

The same rules are in the shared schema: `isValidSlug`, `normalizeSlug`, `SLUG_MIN`, `SLUG_MAX`,
`SLUG_PATTERN`. Use them for the field's local check, so most mistakes never cost a request.

**Output:** `ok({ available: boolean, reason: SlugReason | null })`

| `reason`        | Meaning                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `null`          | Available (`available: true`).                                            |
| `SLUG_INVALID`  | Breaks the rules above. A tab or line break in the value is also invalid. |
| `SLUG_RESERVED` | A reserved word (for example `admin`, `www`, `api`).                      |
| `SLUG_TAKEN`    | Another restaurant uses it.                                               |

A taken or reserved slug is a **successful** answer (`ok: true, available: false`), not an error.
Availability is only a hint: the slug can be taken a moment later. The create action is the check
that counts.

**Errors:** `validation` (`slug: ["org.slug.invalid"]` when the input is not a string),
`unauthenticated`, `rate_limited`, `forbidden` (blocked as a bot), `unavailable`.
An unknown answer from the database is never reported as available.

**Rate limit:** 30 per user and 60 per IP, each per 10 minutes. It exists so the check can't be used
to list which restaurants exist.

## `createOrganization(input)`

Creates the organization, its five system roles, a trial subscription, the caller as **Owner**, its
first location and an audit entry, in one database transaction.

| Field              | Type              | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`             | string            | Trimmed, 1 to 120 characters. `org.field.required`, `org.name.too_long`.                                                                                                                                                                                                                                                                                                                                                                                     |
| `slug`             | string            | As `checkSlug`. `org.slug.invalid`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `timezone`         | string, optional  | A **canonical IANA** name: `UTC`, or `Area/City` for the areas Africa, America, Antarctica, Arctic, Asia, Atlantic, Australia, Europe, Indian, Pacific. Aliases and POSIX strings (`US/Eastern`, `UTC+7`, `Etc/GMT-7`) are refused: `org.timezone.invalid`. Blank means `Asia/Jakarta`. Also the first location's timezone. Offer a picker with **`Asia/Jakarta` (WIB), `Asia/Makassar` (WITA) and `Asia/Jayapura` (WIT) first**, then the rest of the list. |
| `locationName`     | string, optional  | Trimmed, at most 120 characters. Blank means the restaurant's name.                                                                                                                                                                                                                                                                                                                                                                                          |
| `address`          | string, optional  | Trimmed, at most 500 characters. Blank means none.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `taxBps`           | integer, optional | 0 to 10000 basis points (1100 = 11%). Blank means 0. `org.bps.invalid`.                                                                                                                                                                                                                                                                                                                                                                                      |
| `serviceChargeBps` | integer, optional | 0 to 10000. Blank means 0.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `taxOnService`     | boolean           | A checkbox (`"on"`) or a boolean. Default false. `org.field.invalid` for anything else.                                                                                                                                                                                                                                                                                                                                                                      |

Money and rates are never decimals: show a percentage in the form and send basis points.

**Output:** `ok({ orgId: string, slug: string })`. Redirect the page into the org's
admin pages under `/app` (the frontend decides the exact path; `slug` is the org's address). The caller is the Owner there, with every permission: `getOrgContext` answers
`ok` immediately, because the action refreshes the caller's membership cache first.

**Errors**

| Code                                                                           | `fieldErrors`                                          | When                                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `validation`                                                                   | the field keys above                                   | An input rule. Nothing was asked of the database.                                                      |
| `validation`                                                                   | `name: ["org.name.invalid"]`                           | The database refused the name.                                                                         |
| `validation`                                                                   | `slug: ["org.slug.invalid"]` / `["org.slug.reserved"]` | Invalid or reserved slug.                                                                              |
| `conflict`                                                                     | `slug: ["org.slug.taken"]`                             | The slug is taken. **A second submit of the same form gets this**; there is never a second restaurant. |
| `forbidden`                                                                    | `form: ["org.cap_reached"]`                            | The user already owns the most restaurants allowed (3).                                                |
| `feature_unavailable`                                                          | `form: ["org.plan_limit.locations"]`                   | The starting package has no room for the first location.                                               |
| `validation`                                                                   | `timezone: ["org.timezone.invalid"]`                   | The database refused the timezone.                                                                     |
| `validation`                                                                   | `form: ["org.field.invalid"]`                          | Another table rule (a value too long).                                                                 |
| `unauthenticated`, `rate_limited`, `forbidden` (bot), `unavailable`, `unknown` | none                                                   | As in [README.md](./README.md).                                                                        |

A database error never shows its own text.

**Rate limit:** 5 per user and 10 per IP, each per hour.

**Cache tags refreshed:** `user:<userId>:memberships`, `org:<orgId>:member:<userId>` (for the
caller, so the new org appears at once).

**Idempotency:** none needed. The slug is unique, so a double submit makes one restaurant and
answers `conflict` for the second. Disable the submit button while it runs anyway.

## Message keys

| Field              | Keys                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `name`             | `org.field.required` (blank), `org.name.too_long` (over 120), `org.name.invalid` (the database refused it) |
| `slug`             | `org.slug.invalid`, `org.slug.reserved`, `org.slug.taken` (`conflict`)                                     |
| `timezone`         | `org.timezone.invalid`                                                                                     |
| `locationName`     | `org.location_name.too_long` (over 120)                                                                    |
| `address`          | `org.address.too_long` (over 500)                                                                          |
| `taxBps`           | `org.bps.invalid`                                                                                          |
| `serviceChargeBps` | `org.bps.invalid`                                                                                          |
| `taxOnService`     | `org.field.invalid`                                                                                        |
| `form`             | `org.cap_reached`, `org.plan_limit.locations`, `org.field.invalid`                                         |

`org.bps.invalid` is the one key for every bad rate: not a number (`abc`, `NaN`, `Infinity`), not a
whole number (`1.5`), negative, or above 10000. `org.field.invalid` is the fallback for anything else
wrong with a field (also a non-text value where text is expected). An unknown plan-limit name becomes
`org.plan_limit.<name>`; only `locations` happens today.

## `listMyOrganizations()`

For `/app` (none: create one; one: go in; several: pick), the shell's switcher, and the create page's
cap check. Signed-in user, no input, no org permission. Own data only: nothing about other members.

**Output:** `ok({ user, organizations, atCap })`

```ts
type MyOrganization = {
  orgId: string;
  slug: string;
  name: string;
  orgStatus: "active" | "suspended";
  memberStatus: "active" | "deactivated";
  roleId: string;
  roleKey: string | null; // null for a custom role; "owner" | "manager" | "cashier" | "waiter" | "kitchen"
  roleName: string;
};
// user: { email: string | null; fullName: string | null }  (fullName from the profile, else null)
// atCap: boolean
```

- It lists **every** membership, including **suspended** orgs and **deactivated** memberships, so the
  page can show the right notice: `orgStatus: "suspended"` is the suspended notice, `memberStatus:
"deactivated"` is the access-removed notice. Go straight into an org only when both are `active`.
  The order is the order the orgs were created.
- **`atCap`** is true when the user already has **3 active Owner memberships** (the most one person
  can own), counting suspended orgs as the database does. A manager or custom-role membership, or a
  deactivated Owner membership, does not count. Use it to warn on the create page before the form;
  `createOrganization` still answers `forbidden` + `org.cap_reached` if it was wrong.
- A user with no memberships gets an empty list and `atCap: false` (and a person who just signed up
  has none: send them to create a restaurant).
- **Errors:** `unauthenticated`, `unavailable` (also for a row with an unknown status: never shown as a
  known one). Read it inside `<Suspense>`.

## `listLocations({ orgId })`

The locations the caller can reach, for the pickers in invite and set-locations. Any active member of
the org may call it; the database decides what they see (Owner and Manager: every location; others:
the locations they work at).

| Field   | Type | Rules               |
| ------- | ---- | ------------------- |
| `orgId` | uuid | `org.field.invalid` |

**Output:** `ok({ locations: { id: string; name: string; timezone: string }[] })`, A to Z by name, at
most 200. Nothing else about a location is returned.

**Errors:** `validation`, the access errors (`unauthenticated`, `no_membership`, `org_suspended`,
`member_deactivated`), `unavailable`.
