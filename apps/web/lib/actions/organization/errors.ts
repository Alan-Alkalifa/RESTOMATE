import { fail } from "../../auth/result";

/**
 * A database error from `create_organization` as an action result: a stable code and message
 * keys, never the database's text. The RPC raises its codes as the exception message (P0001), the
 * timezone trigger raises 22023 'invalid timezone', and the table checks raise 23514.
 */
type DbError = { code?: unknown; message?: unknown } | null | undefined;

export function createOrgErrorResult(error: DbError): ReturnType<typeof fail> {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";

  // No SQLSTATE: the request never got an answer from the database (network, timeout, abort).
  if (code === "") return fail("unavailable");
  if (code === "28000" || message === "UNAUTHENTICATED") return fail("unauthenticated");

  switch (message) {
    case "NAME_INVALID":
      return fail("validation", { name: ["org.name.invalid"] });
    case "SLUG_INVALID":
      return fail("validation", { slug: ["org.slug.invalid"] });
    case "SLUG_RESERVED":
      return fail("validation", { slug: ["org.slug.reserved"] });
    case "SLUG_TAKEN":
      return fail("conflict", { slug: ["org.slug.taken"] });
    case "ORG_CAP":
      return fail("forbidden", { form: ["org.cap_reached"] });
  }
  if (message.startsWith("PLAN_LIMIT:")) {
    // The key is the database's own limit name (`locations`, `staff`, ...), never user input.
    const key = message.slice("PLAN_LIMIT:".length).replace(/[^a-z_]/g, "") || "unknown";
    return fail("feature_unavailable", { form: [`org.plan_limit.${key}`] });
  }
  if (code === "22023" && message === "invalid timezone") {
    return fail("validation", { timezone: ["org.timezone.invalid"] });
  }
  if (code === "23514" || code === "22001")
    return fail("validation", { form: ["org.field.invalid"] });
  if (code === "57014") return fail("unavailable"); // statement timeout
  return fail("unknown");
}
