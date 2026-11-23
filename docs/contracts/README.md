# Contracts

What the backend promises the frontend. One file per module, written for the frontend step (a
screen can be built from these files without reading the server code).

| Module                                                         | File                                 | Task               |
| -------------------------------------------------------------- | ------------------------------------ | ------------------ |
| Auth: actions, routes, email links, the access layer pages use | [auth.md](./auth.md)                 | M0-BE-20, M0-BE-15 |
| Organization: check a slug, create a restaurant                | [organization.md](./organization.md) | M0-BE-21           |
| Staff: invitations, members                                    | [staff.md](./staff.md)               | M0-BE-22, M0-BE-30 |
| Roles: custom roles                                            | [roles.md](./roles.md)               | M0-BE-23           |

Names only: no secret or environment value is written in these files.

## The result every action returns

```ts
// import type { ActionResult, ActionErrorCode } from "@/lib/auth";
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ActionErrorCode; fieldErrors?: Record<string, string[]> } };
```

- `code` is a stable string. Show text by code; there is no human text from the server.
- `fieldErrors` maps a **field name** to **message keys** (for example `{ email: ["auth.email.invalid"] }`).
  A key is translated in English and Bahasa Indonesia by the frontend. The field `form` means "the
  whole form, not one field". A message never contains what the user typed.
- Some actions end with a **redirect** instead of `ok` (login, reset password, sign out). A redirect
  throws inside the action, so a client component never sees a result for it. Use the action from a
  form (`useActionState` with `(_prev, formData) => action(formData)`) and let Next follow it.
- Every action takes one argument, `input`: a `FormData`, or a plain object with the same field names.
  The same Zod schema runs on the client and the server (`schemas.ts` next to each action file, which
  is safe to import in a client component: no secrets and no `server-only`).

### Codes

| Code                  | Meaning                                                                                                                                     | What the screen does                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `validation`          | An input is wrong. `fieldErrors` says which.                                                                                                | Show each key next to its field (`form` at the top).                       |
| `unauthenticated`     | No signed-in user (or the session ended).                                                                                                   | Send to `/login?next=<this page>`.                                         |
| `no_membership`       | Not a member of that org, or it does not exist (the same answer for both).                                                                  | 404.                                                                       |
| `org_suspended`       | A member, but the org is suspended.                                                                                                         | The suspended notice. No data.                                             |
| `member_deactivated`  | The member was deactivated.                                                                                                                 | The access-removed notice.                                                 |
| `forbidden`           | Signed in, but not allowed (no permission, or a rule such as "not yourself").                                                               | "You can't do this." Hide the control when you can.                        |
| `feature_unavailable` | The org's package does not allow it (a plan limit or a missing feature). `fieldErrors.form` says which.                                     | Offer the upgrade path.                                                    |
| `not_platform_admin`  | Not a platform admin.                                                                                                                       | 404 on `/admin`.                                                           |
| `invalid_credentials` | Login: wrong email or password (never says which).                                                                                          | Generic "email or password is wrong".                                      |
| `email_not_confirmed` | Login: right password, address not confirmed.                                                                                               | Offer to resend the confirmation.                                          |
| `invalid_token`       | A link or token that is wrong, expired, used or revoked.                                                                                    | "This link no longer works", with a way to ask again.                      |
| `conflict`            | The change clashes with the current state (a taken slug, an existing invitation, the last Owner, already active). `fieldErrors` says which. | Show the key.                                                              |
| `rate_limited`        | Too many tries.                                                                                                                             | "Try again in a few minutes." Never retry in a loop.                       |
| `not_found`           | The thing does not exist.                                                                                                                   | 404 or "not found".                                                        |
| `unavailable`         | Auth or the database could not be reached in time. Nothing was changed.                                                                     | Error state with retry. **Not** "signed out" and **not** "wrong password". |
| `unknown`             | Anything else. Nothing is shown from the server.                                                                                            | Generic error with retry.                                                  |

An action that creates something and may fail halfway never leaves half a record: every database
write is one transaction.

### Message key families

`auth.*`, `org.*`, `staff.*`, `role.*`, and the shared `validation` ones listed in each file. Keys
are stable: a new key is added, an old one is never reused for another meaning.
