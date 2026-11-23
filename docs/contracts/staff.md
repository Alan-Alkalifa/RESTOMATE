# Staff contract

Invite people, manage their roles, locations and access. Result and code conventions are in
[README.md](./README.md); how a page gets the org context is in [auth.md](./auth.md).

> Status: written from PR #47 (M0-BE-22). Finish-check against the merged code before REYKI relies
> on it.

Import from `@/lib/actions/staff/actions`; schemas from `@/lib/actions/staff/schemas` (safe in a
client component). Server Actions. Input is a `FormData` or a plain object.

## Who may do what

Every action **except `acceptInvitation`** first checks, on the server, that the caller is an
active member of the org **and holds `staff.manage`**; anything else is `forbidden`
(or `no_membership`, `org_suspended`, `member_deactivated`, `unavailable` from the org context).
A Cashier calling any of them gets `forbidden` and nothing happens. The database then applies its
own rules **as the caller** (second line):

- You can only give a role whose permissions you hold, and only an Owner gives or takes the Owner role.
- You can't change your own role or status.
- A member whose role holds permissions you lack is out of reach (`forbidden`).
- The last active Owner can't be changed or deactivated (`conflict`, `staff.member.last_owner`).

Hide controls a user can't use with `hasPermission(ctx, "staff.manage")`, but never rely on hiding.

All IDs are UUIDs. `orgId` is **always** sent by the caller and is always re-checked against the
caller's membership. An ID that doesn't exist and an ID of another org give the same `forbidden`.

## Invitations

An invitation is for one email, one role and some locations (or all locations). It lives 7 days, and
holds a staff slot of the package while it is open. There is at most one open invitation per email per org.

### `inviteStaff(input)`

| Field | Type | Rules |
|---|---|---|
| `orgId` | uuid | `staff.org.invalid`. |
| `email` | string | Trimmed, lower-cased, a valid address of at most 254 characters, local part at most 64: `staff.email.invalid`, `staff.field.required`. |
| `roleId` | uuid | A role of this org: `staff.role.invalid`. |
| `allLocations` | boolean | Checkbox `"on"` or boolean. Default false. |
| `locationIds` | uuid[] | Repeat the field in `FormData`, or send an array. At most 200. **Needs at least one unless `allLocations`**: `locationIds: ["staff.locations.required"]`. Sending both is `staff.locations.invalid`. |

**Output:** `ok({ invitationId: string, emailSent: boolean })`

- `emailSent: false` means the invitation **exists** but the email failed to go out. Say so and offer
  **Resend**; do not invite again (that would be a second open invitation: `conflict`).
- The email goes to one address, with the accept link (below). The raw token is only in that email.

**Errors**

| Code | `fieldErrors` | When |
|---|---|---|
| `validation` | the keys above | An input rule. |
| `validation` | `email: ["staff.email.invalid"]` / `roleId: ["staff.role.invalid"]` / `locationIds: ["staff.locations.invalid"]` | The database refused it (a role outside the org, a location outside the org or out of the caller's reach). |
| `forbidden` | none | No `staff.manage`, or **escalation**: a role or permission the caller lacks. |
| `feature_unavailable` | `form: ["staff.plan_limit.staff"]` | The package's staff limit is full (open invitations count). |
| `conflict` | `email: ["staff.invitation.exists"]` | An open invitation for this email exists. Offer Resend or Revoke. |
| `conflict` | `form: ["staff.invitation.already_member"]` | The email belongs to an active member. |
| `unauthenticated`, `no_membership`, `org_suspended`, `member_deactivated`, `unavailable`, `unknown` | none | As in [README.md](./README.md). |

### `resendInvitation({ orgId, invitationId })`

Revokes the open invitation and creates a **new** one (new token, new row, new email key) for the same
email, role and locations, then emails it. The old link stops working at once.

**Output:** `ok({ invitationId: string, emailSent: boolean })`: the **new** invitation's ID. Replace the
old ID in the list.

**Errors:** `validation` (`staff.org.invalid`, `staff.invitation.invalid`), `forbidden` (not
`staff.manage`, or an invitation that doesn't exist or belongs to another org), `conflict`
(`form: ["staff.invitation.closed"]`: it was already accepted or revoked), `feature_unavailable`
(`staff.plan_limit.staff`), plus the access errors.

### `revokeInvitation({ orgId, invitationId })`

Closes an open invitation; its link stops working.

**Output:** `ok()`. **Errors:** as resend (`conflict` `staff.invitation.closed` when already closed).

### `acceptInvitation({ token })`

For the **invitee**, from the email link. Needs a signed-in user whose **confirmed** email equals the
invitation's. No `staff.manage` (the invitee isn't a member yet).

| Field | Rules |
|---|---|
| `token` | The 43 characters of the link (`A-Z a-z 0-9 _ -`). Anything else is `invalid_token` without asking the database. |

**Output:** `ok({ orgId: string, slug: string })`: redirect into the org. The new member is active,
with the invitation's role and locations.

**Errors**

| Code | When |
|---|---|
| `invalid_token` | Unknown, used, revoked or expired link, an unconfirmed account, or a suspended org. **One code for all of them** (nothing says which). Offer "ask your manager to send a new invitation". |
| `forbidden` + `form: ["staff.invitation.email_mismatch"]` | Signed in with a different address than the invitation's. Offer to sign out and use the invited address. |
| `conflict` + `form: ["staff.invitation.already_member"]` | Already an active member of the org. Go to the org. |
| `unauthenticated` | Not signed in. Send to `/login?next=/invite/accept?token=...` (encode `next`), or to sign-up with the invited address. |
| `unavailable`, `unknown` | As in [README.md](./README.md). |

### The invitation email link

`<NEXT_PUBLIC_APP_URL>/invite/accept?token=<43-character token>`

The page at `/invite/accept` is the frontend's. It reads `token`, needs a signed-in user (login or
sign-up first, keeping the link as `next`), and calls `acceptInvitation`. The link works once and the
invitation expires after 7 days. The email body is a plain-text placeholder until M0-FE-10 replaces
`renderInvitationEmail` (`@/lib/actions/staff/email`): it receives `{ orgName, roleName, acceptUrl }`
and returns `{ subject, html, text }`.

## Members

### `changeMemberRole({ orgId, memberId, roleId })`

**Output:** `ok()`. Takes effect on that member's next request.

**Errors:** `validation` (`staff.member.invalid`, `staff.role.invalid`), `forbidden` (no
`staff.manage`; **your own row**; a member you can't act on; a role you can't give), `conflict`
(`form: ["staff.member.last_owner"]`), plus the access errors.

### `deactivateMember({ orgId, memberId })`

The member keeps their history but loses access. The database ends **every session of that user in
the same transaction** (all devices, and their other orgs' sessions too); a token already issued
works for up to an hour at the auth layer, but every request re-checks membership and a deactivated
member is refused (`member_deactivated`).

**Output:** `ok()`. **Errors:** as `changeMemberRole`, and `conflict`
`form: ["staff.member.already_deactivated"]`. Never yourself, never the last Owner.

### `reactivateMember({ orgId, memberId })`

Takes a staff slot again. Not on your own row.

**Output:** `ok()`. **Errors:** as `changeMemberRole`; `conflict`
`form: ["staff.member.already_active"]`; `feature_unavailable` `form: ["staff.plan_limit.staff"]`.

### `setMemberLocations({ orgId, memberId, locationIds })`

Replaces the member's locations. The Owner and Manager reach every location regardless.

| Field | Rules |
|---|---|
| `locationIds` | uuid[] (may be empty, at most 200). `staff.locations.invalid` for a bad ID. |

**Output:** `ok()`. **Errors:** `validation` (`locationIds: ["staff.locations.invalid"]` also when a
location is outside the org or out of the caller's reach), `forbidden` (no `staff.manage`; your own
row; a member you can't act on), plus the access errors.

## Rate limits and caches

- The staff actions have no per-action rate limit of their own; they sit behind the proxy's shield
  and bot rules, and every one needs a signed-in member holding `staff.manage`.
- Cache tags refreshed (IDs only): for `acceptInvitation`, `user:<userId>:memberships` and
  `org:<orgId>:member:<userId>` of the caller; for `changeMemberRole`, `deactivateMember`,
  `reactivateMember` and `setMemberLocations`, the same two for the **member acted on**.
- **Reading the lists.** The member list is readable by a manager through the user's own client
  (RLS: a member sees their own row, `staff.manage` sees all of the org's). **Invitations are not
  readable by the signed-in role at all** (no grant on `staff_invitations`), so the pending-invitation
  list needs a server read. **OPEN: this contract does not define it yet** (see the PR for MF-T25); do
  not build the invitations list until it does. A closed invitation can have **no role** (its role was
  deleted afterwards): show it as "role deleted".

## Message keys

`staff.field.required`, `staff.field.invalid`, `staff.org.invalid`, `staff.email.invalid`,
`staff.role.invalid`, `staff.member.invalid`, `staff.invitation.invalid`, `staff.locations.invalid`,
`staff.locations.required`, `staff.invitation.exists`, `staff.invitation.already_member`,
`staff.invitation.email_mismatch`, `staff.invitation.closed`, `staff.member.last_owner`,
`staff.member.already_active`, `staff.member.already_deactivated`, `staff.plan_limit.staff`.
