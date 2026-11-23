import { fail } from "../../auth/result";

/**
 * A database error from a staff RPC or write as an action result: a stable code and message keys,
 * never the database's text. Codes come from the RPC and guard contracts (M0-BE-11, M0-BE-12).
 */
type DbError = { code?: unknown; message?: unknown } | null | undefined;

export function staffErrorResult(error: DbError): ReturnType<typeof fail> {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";

  if (code === "") return fail("unavailable"); // no SQLSTATE: no answer from the database
  if (code === "28000" || message === "UNAUTHENTICATED") return fail("unauthenticated");

  switch (message) {
    case "INVITATION_INVALID":
      return fail("invalid_token");
    case "INVITATION_EMAIL_MISMATCH":
      return fail("forbidden", { form: ["staff.invitation.email_mismatch"] });
    case "ALREADY_MEMBER":
      return fail("conflict", { form: ["staff.invitation.already_member"] });
    case "INVITATION_EXISTS":
      return fail("conflict", { email: ["staff.invitation.exists"] });
    case "ESCALATION_DENIED":
    case "FORBIDDEN":
      return fail("forbidden");
    case "LAST_OWNER":
      return fail("conflict", { form: ["staff.member.last_owner"] });
    case "LOCATION_INVALID":
      return fail("validation", { locationIds: ["staff.locations.invalid"] });
    case "EMAIL_INVALID":
      return fail("validation", { email: ["staff.email.invalid"] });
    case "ROLE_INVALID":
      return fail("validation", { roleId: ["staff.role.invalid"] });
    case "STATUS_INVALID":
      return fail("validation", { form: ["staff.field.invalid"] });
    case "INVITATION_CLOSED":
      return fail("conflict", { form: ["staff.invitation.closed"] });
    case "MEMBER_ALREADY_ACTIVE":
      return fail("conflict", { form: ["staff.member.already_active"] });
    case "MEMBER_ALREADY_DEACTIVATED":
      return fail("conflict", { form: ["staff.member.already_deactivated"] });
    case "TOKEN_INVALID": // the server made the token: a clash means "try again", never the user's fault
      return fail("unknown");
    case "MEMBER_DELETE":
    case "MEMBER_KEYS_IMMUTABLE":
      return fail("forbidden");
  }
  if (message.startsWith("PLAN_LIMIT:")) {
    const key = message.slice("PLAN_LIMIT:".length).replace(/[^a-z_]/g, "") || "unknown";
    return fail("feature_unavailable", { form: [`staff.plan_limit.${key}`] });
  }
  if (code === "23505") return fail("conflict", { email: ["staff.invitation.exists"] }); // one open per email
  if (code === "42501") return fail("forbidden");
  if (code === "23514" || code === "22001" || code === "23503") {
    return fail("validation", { form: ["staff.field.invalid"] });
  }
  if (code === "57014") return fail("unavailable");
  return fail("unknown");
}
