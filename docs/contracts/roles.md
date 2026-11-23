# Roles contract

Custom roles: create, edit and delete a role, and what a role may hold. Result and code
conventions are in [README.md](./README.md); how a page gets the org context is in [auth.md](./auth.md);
giving a role to a person is in [staff.md](./staff.md).

> Status: written from PR #49 (M0-BE-23, ADIT) and the database rules (M0-BE-08, 11, 30). Finish-check
> against the merged code. The actions are ADIT's; this file is the frontend's view of them.

Import from `@/lib/actions/roles/actions`; schemas and limits from `@/lib/actions/roles/schemas`
(safe in a client component). Server Actions. Input is a `FormData` or a plain object.

## The model

- A **role** has a name, an optional description and a set of **permission keys** (`PERMISSION_KEYS`,
  listed in [auth.md](./auth.md)).
- Every org has five **system roles** made with the org: Owner, Manager, Cashier, Waiter, Kitchen. A
  system role **can't be changed or deleted**, and its permissions are fixed. The Owner holds every
  permission, implicitly. Show them read-only.
- **Custom roles** belong to one org and need the package feature `custom_roles`
  (`hasFeature(ctx, "custom_roles")`). Without it, create and edit are refused
  (`feature_unavailable`); **delete stays possible** after a downgrade.
- A role is per org. A role of another org, and an ID that doesn't exist, give the same `forbidden`.

## Who may do what

Every action needs, on the server: a signed-in active member of the org, holding `staff.manage`
(`forbidden` otherwise; the access errors `unauthenticated`, `no_membership`, `org_suspended`,
`member_deactivated`, `unavailable` pass through from the org context). Then:

- **No escalation.** You can only give a role a permission you hold yourself. To change or delete a
  role you must hold **every** permission it has now. Breaking this is
  `forbidden` with `permissions: ["roles.permissions.not_held"]`. The server checks it before the
  database does, and the database checks it again.
- Hide or disable the permission checkboxes the caller doesn't hold
  (`ctx.permissions`), and a role the caller can't edit. Never rely on hiding.

## Which organization

Every role action takes **exactly one** of:

| Field | Type |
|---|---|
| `orgId` | uuid |
| `orgSlug` | string (1 to 64 characters), the org's address |

Both, or neither, is `validation` (`orgId: ["roles.org.invalid"]`). Access is decided from the
signed-in user's membership, never from this value.

## `createRole(input)`

| Field | Type | Rules |
|---|---|---|
| `orgId` \| `orgSlug` | | See above. |
| `name` | string | Cleaned first: Unicode-normalized (NFKC), invisible format characters removed, every run of whitespace becomes one space, trimmed. Then 1 to 60 characters, no control characters. `roles.name.required`, `roles.name.too_long`, `roles.name.invalid`. |
| `description` | string, optional | Trimmed, up to 300 characters, blank means none. `roles.description.too_long`, `roles.description.invalid`. A newline or tab is allowed inside. |
| `permissions` | permission key[] | Distinct keys from the catalog; duplicates are dropped. An empty list is a role that grants nothing. In `FormData`, repeat the field once per checked key. `roles.permissions.invalid`. |

**Output:** `ok({ roleId: string })`.

## `updateRole(input)`

| Field | Type | Rules |
|---|---|---|
| `orgId` \| `orgSlug` | | See above. |
| `roleId` | uuid | `roles.role.invalid`. |
| `name` | string, optional | As create. **Not sent = keep.** |
| `description` | string, optional | As create. Not sent = keep. **`""` clears it.** |
| `permissions` | permission key[], optional | The **full new list**. Not sent = keep. `[]` removes them all. |

Send only the fields the form changed, or the whole form: both work. An absent field means "keep".

**The permissions checkboxes and `permissions_submitted`.** A `FormData` with no checked box has no
`permissions` field, which would read as "keep". So a role form includes a **hidden field
`permissions_submitted`** (any value, for example `1`) whenever it shows the permission checkboxes:

| Form sends | Means |
|---|---|
| `permissions_submitted` and one or more `permissions` | Replace the permissions with these. |
| `permissions_submitted` and **no** `permissions` | **Clear all** permissions. |
| neither | **Keep** the current permissions. |

A plain object does not need the marker: `permissions: [...]` replaces, `permissions: []` clears,
absent keeps. *(Added in PR #49 after review; confirm against the merged code.)*

**Output:** `ok()`.

## `deleteRole(input)`

| Field | Type |
|---|---|
| `orgId` \| `orgSlug` | See above. |
| `roleId` | uuid |

Needs no package feature. **Refused while a member holds the role or an open invitation names it**
(`conflict`, `roles.in_use`): move those members to another role, or revoke the invitations, first.
Closed (accepted or revoked) invitations don't block it; they keep their history and lose their role
(shown as "role deleted").

**Output:** `ok()`.

## Errors

| Code | `fieldErrors` | When |
|---|---|---|
| `validation` | the keys in the tables above | An input rule. Nothing was asked of the database. |
| `validation` | `name: ["roles.name.invalid"]` | The database refused the name. |
| `validation` | `description: ["roles.description.too_long"]` | The database refused the description. |
| `validation` | `permissions: ["roles.permissions.invalid"]` | An unknown permission key. |
| `conflict` | `name: ["roles.name.taken"]` | Another role of the org has the same name, **ignoring case** (after cleaning). |
| `conflict` | `form: ["roles.in_use"]` | Delete: a member or an open invitation holds the role. |
| `forbidden` | none | No `staff.manage`, a role of another org, an unknown ID. |
| `forbidden` | `permissions: ["roles.permissions.not_held"]` | Escalation (see above). |
| `forbidden` | `form: ["roles.system_role"]` | A system role can't be changed or deleted. |
| `feature_unavailable` | `form: ["roles.feature_unavailable"]` | Create or update: the package has no `custom_roles`. Offer the upgrade. |
| `unauthenticated`, `no_membership`, `org_suspended`, `member_deactivated`, `unavailable`, `unknown` | none | As in [README.md](./README.md). |

The role actions have no per-action rate limit of their own (the proxy's shield and bot rules apply).

## Cache and freshness

Each action refreshes the caller's own access tags (`user:<userId>:memberships`,
`org:<orgId>:member:<userId>`), so the caller sees the change at once. **Other members** holding the
role see a permission change within about 30 seconds in the UI (a private cache), but **never gain
access earlier than the database allows**: every request re-checks the database. Don't tell a
manager that a change is instant for everyone.

## Reading roles (for the editor and the staff screens)

- **Roles and their permissions** are readable by every member of the org through the user's own
  Supabase client (RLS): `roles` (`id`, `name`, `description`, `is_system`, `system_key`) and
  `role_permissions` (`role_id`, `permission_key`). A deleted role is gone; a member's `role_id`
  always exists.
- **The permission catalog** is `PERMISSION_KEYS` in `@/lib/auth` (24 keys). Group and label the keys
  in the UI (translated); the server only knows the keys.
- **Whether custom roles are available** is `hasFeature(ctx, "custom_roles")`.
- Showing "who holds this role" needs a count of members per role; a manager can read the member list
  (see [staff.md](./staff.md)).

## Message keys

`roles.org.invalid`, `roles.role.invalid`, `roles.name.required`, `roles.name.too_long`,
`roles.name.invalid`, `roles.name.taken`, `roles.description.invalid`,
`roles.description.too_long`, `roles.permissions.invalid`, `roles.permissions.not_held`,
`roles.system_role`, `roles.in_use`, `roles.feature_unavailable`, `roles.field.invalid` (anything
else).
