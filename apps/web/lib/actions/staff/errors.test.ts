import { describe, expect, it } from "vitest";
import { staffErrorResult } from "./errors";

const e = (message: string, code = "P0001") => ({ code, message });

describe("staffErrorResult", () => {
  it.each([
    [e("INVITATION_INVALID"), { code: "invalid_token" }],
    [
      e("INVITATION_EMAIL_MISMATCH"),
      { code: "forbidden", fieldErrors: { form: ["staff.invitation.email_mismatch"] } },
    ],
    [
      e("ALREADY_MEMBER"),
      { code: "conflict", fieldErrors: { form: ["staff.invitation.already_member"] } },
    ],
    [
      e("INVITATION_EXISTS"),
      { code: "conflict", fieldErrors: { email: ["staff.invitation.exists"] } },
    ],
    [
      e('duplicate key value violates unique constraint "staff_invitations_one_open_idx"', "23505"),
      { code: "conflict", fieldErrors: { email: ["staff.invitation.exists"] } },
    ],
    [
      e("ESCALATION_DENIED", "42501"),
      { code: "forbidden", fieldErrors: { form: ["staff.escalation_denied"] } },
    ],
    [e("FORBIDDEN", "42501"), { code: "forbidden" }],
    [e("permission denied for table staff_invitations", "42501"), { code: "forbidden" }],
    [e("LAST_OWNER"), { code: "conflict", fieldErrors: { form: ["staff.member.last_owner"] } }],
    [
      e("LOCATION_INVALID"),
      { code: "validation", fieldErrors: { locationIds: ["staff.locations.invalid"] } },
    ],
    [
      e("PLAN_LIMIT:staff"),
      { code: "feature_unavailable", fieldErrors: { form: ["staff.plan_limit.staff"] } },
    ],
    [e("EMAIL_INVALID"), { code: "validation", fieldErrors: { email: ["staff.email.invalid"] } }],
    [e("ROLE_INVALID"), { code: "validation", fieldErrors: { roleId: ["staff.role.invalid"] } }],
    [e("STATUS_INVALID"), { code: "validation", fieldErrors: { form: ["staff.field.invalid"] } }],
    [
      e("INVITATION_CLOSED"),
      { code: "conflict", fieldErrors: { form: ["staff.invitation.closed"] } },
    ],
    [
      e("MEMBER_ALREADY_ACTIVE"),
      { code: "conflict", fieldErrors: { form: ["staff.member.already_active"] } },
    ],
    [
      e("MEMBER_ALREADY_DEACTIVATED"),
      { code: "conflict", fieldErrors: { form: ["staff.member.already_deactivated"] } },
    ],
    [e("TOKEN_INVALID"), { code: "unknown" }],
    [e("MEMBER_DELETE"), { code: "forbidden" }],
    [e("UNAUTHENTICATED", "28000"), { code: "unauthenticated" }],
    [e("canceling statement due to statement timeout", "57014"), { code: "unavailable" }],
    [{ code: "", message: "TypeError: fetch failed" }, { code: "unavailable" }],
    [e("something new", "XX000"), { code: "unknown" }],
  ])("maps %j to a stable code, with no database text", (error, expected) => {
    const r = staffErrorResult(error);
    expect(r).toEqual({ ok: false, error: expected });
    expect(JSON.stringify(r)).not.toMatch(
      /duplicate|permission denied|statement|fetch failed|something/,
    );
  });
});
