# Roles contract

Custom roles: create, edit and delete a role, and what a role may hold. Result and code
conventions are in [README.md](./README.md); how a page gets the org context is in [auth.md](./auth.md).

> **DRAFT. The Server Actions are M0-BE-23 (ADIT) and are not merged.** This file records what the
> **database** already guarantees (M0-BE-08, M0-BE-11, M0-BE-30), which the actions sit on. The action
> names, import path, input schemas, message keys and the code each database error maps to are
> **TBD**: they are filled in from the merged M0-BE-23 code, and REYKI should not build the role
> editor (M0-FE-08) from the TBD parts.

## The model

- A **role** has a name, an optional description and a set of **permission keys** (the catalog is
  `PERMISSION_KEYS`, listed in [auth.md](./auth.md)).
- Every org has five **system roles**, made when the org is created: Owner, Manager, Cashier,
  Waiter, Kitchen (names and keys are the database's `system_key`). **A system role can't be
  changed or deleted** (`ROLE_SYSTEM`). Its permissions are fixed. The Owner holds every permission,
  implicitly.
- **Custom roles** belong to one org and are available only when the package has the feature
  `custom_roles` (`hasFeature(ctx, "custom_roles")`). Without it, creating or editing is refused
  (`PLAN_FEATURE:custom_roles`); **deleting stays possible** after a downgrade.
- Roles are **per org**. A role of another org is not visible, and its ID answers `forbidden`.
- Anyone assigning a role goes through [staff.md](./staff.md); the role actions here only manage the
  roles themselves.

## Rules the database enforces

| Rule | Detail |
|---|---|
| Permission to manage | The caller needs `staff.manage` in the org. Anything else is `forbidden`. |
| **No escalation** | Nobody gives a role a permission they don't hold themselves. Changing or deleting a role needs **every** permission the role holds. Breaking it is `ESCALATION_DENIED`. |
| Name | Trimmed, 1 to 60 characters, no whitespace at either end, **unique in the org ignoring case** (`ROLE_NAME_TAKEN`). Otherwise `NAME_INVALID`. |
| Description | Optional, up to 300 characters; blank clears it (`DESCRIPTION_INVALID`). |
| Permissions | Distinct keys from the catalog; an unknown key is `PERMISSION_INVALID`. An empty list is allowed. |
| Update | Every field but the role ID is optional; `null` keeps the current value. For permissions, `null` keeps them and an array **replaces** them (an empty array removes all). |
| Delete | Refused while a member or an **open** invitation holds the role (`ROLE_IN_USE`). Closed (accepted or revoked) invitations don't block it; they lose their role (`role_id` becomes null, shown as "role deleted"). System roles: `ROLE_SYSTEM`. |

## Database error codes and what they will map to

Final `code` and `fieldErrors` keys are decided in M0-BE-23. The intended mapping, for planning:

| Database error | Intended result |
|---|---|
| `FORBIDDEN`, `ESCALATION_DENIED` | `forbidden` |
| `PLAN_FEATURE:custom_roles` | `feature_unavailable` |
| `NAME_INVALID`, `DESCRIPTION_INVALID`, `PERMISSION_INVALID` | `validation` (keys TBD) |
| `ROLE_NAME_TAKEN` | `conflict` on the name field |
| `ROLE_SYSTEM` | `forbidden` |
| `ROLE_IN_USE` | `conflict` |
| `UNAUTHENTICATED` | `unauthenticated` |
| no answer / timeout | `unavailable` |

## TBD from M0-BE-23

- Action names, import path, input fields and limits (the shared Zod schema).
- Output data shapes (for example the created role's ID).
- The message keys (`role.*`).
- How the frontend **lists** roles and their permissions for the editor and the staff screens (members
  can read their org's roles; the permission catalog is read-only).
- Cache tags the actions refresh (a role change changes every holder's permissions: the
  `org:<orgId>:member:<userId>` tags of its holders).
