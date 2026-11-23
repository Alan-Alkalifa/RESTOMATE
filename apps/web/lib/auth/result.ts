/**
 * The one result shape every server action returns (M0-BE-20..23 reuse it), and the one place
 * access errors are named. Codes are stable strings; the UI turns a code into translated text.
 * There is no human text here (no hard-coded copy).
 */

/** Why access was refused. Also valid `ActionError` codes. */
export type AccessDenied =
  | "unauthenticated" // no verified session
  | "no_membership" // not a member of that org, or it does not exist (the two look the same)
  | "org_suspended" // a member, but the org is suspended: the suspended notice, never data
  | "member_deactivated" // the member was deactivated
  | "unavailable"; // the lookup failed; access fails closed

export type ActionErrorCode =
  | AccessDenied
  | "forbidden" // signed in and a member, but without the permission
  | "feature_unavailable" // the org's package does not include the feature
  | "not_platform_admin"
  | "validation"
  | "rate_limited"
  | "conflict"
  | "not_found"
  | "unknown";

export type ActionError = {
  code: ActionErrorCode;
  /** Field name -> message keys, for a form. Never a raw value the user typed. */
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(
  code: ActionErrorCode,
  fieldErrors?: Record<string, string[]>,
): {
  ok: false;
  error: ActionError;
} {
  return { ok: false, error: fieldErrors ? { code, fieldErrors } : { code } };
}
