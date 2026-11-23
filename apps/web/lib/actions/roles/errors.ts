import { fail } from "../../auth/result";

/**
 * A database error from `create_role`, `update_role` or `delete_role` as an action result: a
 * stable code and message keys, never the database's text. The RPCs raise their codes as the
 * exception message (P0001, or 42501 / 28000 for access); see supabase/migrations/*_staff_rpcs.sql.
 */
type DbError = { code?: unknown; message?: unknown } | null | undefined;

export function roleErrorResult(error: DbError): ReturnType<typeof fail> {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";

  // No SQLSTATE: the request never got an answer from the database (network, timeout, abort).
  if (code === "") return fail("unavailable");
  if (code === "28000" || message === "UNAUTHENTICATED") return fail("unauthenticated");

  switch (message) {
    // The role, or the org, is not one the caller manages. An unknown id looks the same.
    case "FORBIDDEN":
      return fail("forbidden");
    // Giving a permission the caller lacks, or editing or deleting a role that holds one.
    case "ESCALATION_DENIED":
      return fail("forbidden", { permissions: ["roles.permissions.not_held"] });
    case "ROLE_SYSTEM":
      return fail("forbidden", { form: ["roles.system_role"] });
    case "NAME_INVALID":
      return fail("validation", { name: ["roles.name.invalid"] });
    case "DESCRIPTION_INVALID":
      return fail("validation", { description: ["roles.description.too_long"] });
    case "PERMISSION_INVALID":
      return fail("validation", { permissions: ["roles.permissions.invalid"] });
    case "ROLE_NAME_TAKEN":
      return fail("conflict", { name: ["roles.name.taken"] });
    case "ROLE_IN_USE":
      return fail("conflict", { form: ["roles.in_use"] });
    case "PLAN_FEATURE:custom_roles":
      return fail("feature_unavailable", { form: ["roles.feature_unavailable"] });
  }
  if (code === "57014") return fail("unavailable"); // statement timeout
  return fail("unknown");
}
