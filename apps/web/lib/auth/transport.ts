/**
 * Whether an error from a Supabase Auth call means "Auth or one of its endpoints could not be
 * reached, or answered with a server failure", and not "the request or token is bad". The two must
 * never be mixed up: an outage must not sign a valid user out or tell someone their password is
 * wrong, and a bad token must never read as an outage.
 *
 * Network failures and aborts reach us as `AuthRetryableFetchError`, a gateway answer (502, 503,
 * 504) too, and a page that is not JSON as `AuthUnknownError`; any other 5xx has its status.
 */
export function isAuthOutage(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  if (name === "AuthRetryableFetchError" || name === "AuthUnknownError") return true;
  return typeof status === "number" && (status === 0 || status >= 500);
}
