# Staff contract

Invite people, manage their roles, locations and access. Result and code conventions are in
[README.md](./README.md); how a page gets the org context is in [auth.md](./auth.md).

> Status: matches the merged code of PR #47 (M0-BE-22). `listInvitations` and the two keys
> `staff.escalation_denied` / `staff.member.self` are in PR #50 (a follow-up to #47); they are part of
> this contract and are final once #50 merges.

Import from `@/lib/actions/staff/actions`; schemas from `@/lib/actions/staff/schemas` (safe in a
client component). Server Actions. Input is a `FormData` or a plain object.

## Who may do what

Every action **except `acceptInvitation`** first checks, on the server, that the caller is an
active member of the org **and holds `staff.manage`**; anything else is `forbidden`
(or `no_membership`, `org_suspended`, `member_deactivated`, `unavailable` from the org context).
A Cashier calling any of them gets `forbidden` and nothing happens. The database then applies its
own rules **as the caller** (second line):

- You can only give a role whose permissions you hold, and only an Owner gives or takes the Owner role.
- You can't change your own role or status. The action refuses it first with
  `forbidden` + `form: ["staff.member.self"]`.
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
| `forbidden` | none | No `staff.manage`, or an id that isn't one of this org's. |
| `forbidden` | `form: ["staff.escalation_denied"]` | **Escalation**: a role or permission the caller lacks (for example giving Owner as a non-Owner). Say "you can't give a role with permissions you don't have". |
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

**Errors:** `validation` (`staff.member.invalid`, `staff.role.invalid`), `conflict`
(`form: ["staff.member.last_owner"]`), plus the access errors, and three different `forbidden`
answers the screen can tell apart:

| `forbidden` with | Means |
|---|---|
| no `fieldErrors` | No `staff.manage`, or a member that isn't one of this org's. |
| `form: ["staff.member.self"]` | It's your own row. Nobody changes their own role or status. |
| `form: ["staff.escalation_denied"]` | A member whose role holds permissions you lack, or a role you can't give (an Owner is changed only by an Owner). |

### `deactivateMember({ orgId, memberId })`

The member keeps their history but loses access. The database ends **every session of that user in
the same transaction** (all devices, and their other orgs' sessions too); a token already issued
works for up to an hour at the auth layer, but every request re-checks membership and a deactivated
member is refused (`member_deactivated`).

**Output:** `ok()`. **Errors:** as `changeMemberRole` (your own row is `staff.member.self`), and
`conflict` `form: ["staff.member.already_deactivated"]`. Never the last Owner.

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
location is outside the org or out of the caller's reach), `forbidden` (no `staff.manage`, a member
that isn't this org's, or a member you can't act on: always the plain `forbidden`, without a key),
plus the access errors.

## Rate limits and caches

- The staff actions have no per-action rate limit of their own; they sit behind the proxy's shield
  and bot rules, and every one needs a signed-in member holding `staff.manage`.
- Cache tags refreshed (IDs only): for `acceptInvitation`, `user:<userId>:memberships` and
  `org:<orgId>:member:<userId>` of the caller; for `changeMemberRole`, `deactivateMember`,
  `reactivateMember` and `setMemberLocations`, the same two for the **member acted on**.
- **Reading the member list:** a manager reads it through the user's own client (RLS: a member sees
  their own row, `staff.manage` sees all of the org's). Roles are readable by every member (see
  [roles.md](./roles.md)).
- **Reading invitations:** use `listInvitations` below. The signed-in role has no read access to
  `staff_invitations`.

## `listInvitations({ orgId, limit? })`

The org's invitations, for the staff screen's pending list.

| Field | Type | Rules |
|---|---|---|
| `orgId` | uuid | `staff.org.invalid`. |
| `limit` | integer, optional | 1 to 200, default 100. Out of range is `validation` (`limit: ["staff.field.invalid"]`), not clamped. |

**Output:** `ok({ invitations: InvitationRow[] })`. Import the type from `@/lib/actions/staff/actions`.

```ts
type InvitationRow = {
  id: string;
  email: string;
  roleId: string | null;       // null: a closed invitation whose role was deleted afterwards
  roleName: string | null;     // null together with roleId; show "role deleted"
  allLocations: boolean;
  locationIds: string[];       // empty when allLocations is true
  createdAt: string;           // ISO 8601
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  status: "open" | "expired" | "accepted" | "revoked";
};
```

- **Order:** `open` (newest first), then `expired`, then `accepted` and `revoked` (newest first). At
  most `limit` rows in all, so a long history is cut off at the end: closed rows are the first to go.
- `expired` is an unaccepted, unrevoked invitation past its 7 days. It no longer holds a staff slot
  and its link no longer works, **but it is still not closed**: it still blocks a new invitation to
  the same email (`conflict`, `staff.invitation.exists`). So `open` **and** `expired` rows can be
  **resent** (that revokes it and sends a fresh one) or **revoked**; only `accepted` and `revoked`
  rows are final (`conflict`, `staff.invitation.closed`). **The UI offers Resend (or Revoke) on both `open` and `expired` rows**,
  and neither on `accepted` or `revoked` ones. For an `expired` row, Resend is the usual button.
- The token and its hash are never in the result. The raw token only exists in the email.
- **Errors:** `validation`, `forbidden` (no `staff.manage`), the access errors, and `unavailable`
  when any read fails (never a partial list).
- No cache tags are involved; refetch after an invite, resend, revoke or accept.

## Message keys

`staff.field.required`, `staff.field.invalid`, `staff.org.invalid`, `staff.email.invalid`,
`staff.role.invalid`, `staff.member.invalid`, `staff.invitation.invalid`, `staff.locations.invalid`,
`staff.locations.required`, `staff.invitation.exists`, `staff.invitation.already_member`,
`staff.invitation.email_mismatch`, `staff.invitation.closed`, `staff.member.last_owner`,
`staff.member.already_active`, `staff.member.already_deactivated`, `staff.member.self`,
`staff.escalation_denied`, `staff.plan_limit.staff`.
