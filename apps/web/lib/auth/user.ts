import "server-only";
import { cacheLife } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createDeadlineGuard } from "../supabase/fetch";
import { AUTH_DOWN_HEADER } from "../supabase/signal";
import { createClient } from "../supabase/server";
import { UUID } from "./keys";
import { loginUrl } from "./next";
import { isAuthOutage } from "./transport";

export type AuthUser = { id: string; email: string | null };

/** Auth could not be reached in time. This is not "signed out". */
export const UNAVAILABLE = "unavailable" as const;
export type CurrentUser = AuthUser | null | typeof UNAVAILABLE;

/** Thrown by `requireUser` during an outage, so the error screen shows and nobody is sent to a login that cannot work. */
export class AuthUnavailableError extends Error {
  constructor() {
    super("auth_unavailable");
    this.name = "AuthUnavailableError";
  }
}

async function loadUser(): Promise<AuthUser | null> {
  "use cache: private";
  cacheLife({ stale: 30 });

  // One deadline for the whole check, refresh and retries included. If Auth does not answer in
  // time, this throws and nothing is cached, so the next request asks again.
  const guard = createDeadlineGuard();
  const supabase = await createClient(guard);
  const outcome = await guard.run(() => supabase.auth.getClaims());
  if (outcome.status !== "done") throw new Error("auth_unavailable");

  const { data, error } = outcome.value;
  const sub = data?.claims?.sub;
  // An unreachable Auth or key endpoint is an outage, not a signed-out user (a bad token is null).
  if (error && isAuthOutage(error)) throw new Error("auth_unavailable"); // nothing cached
  if (error || typeof sub !== "string" || !UUID.test(sub)) return null; // no or invalid session
  const email = data?.claims?.email;
  return { id: sub, email: typeof email === "string" ? email : null };
}

/**
 * The verified user, `null` when there is no valid session, or `"unavailable"` when Auth could not
 * be reached in time. The session is verified with `auth.getClaims()` (the JWT is checked, never
 * the bare cookie); `getSession()` is never used for this. Treat `"unavailable"` as "cannot
 * tell": refuse access, but do not send the user to log in.
 *
 * `'use cache: private'` reads the cookies, so call it inside `<Suspense>` (Cache Components).
 * In production a private result is not kept across requests, so every action still re-checks.
 * A page must never treat a cached result as proof the user is still signed in.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  // The proxy already found Auth down in this very request: say so now, do not wait again.
  // The header is set by `proxy.ts` only (a client's copy is stripped), and is read here, outside
  // the private cache, so a cached answer can never hide it.
  if ((await headers()).get(AUTH_DOWN_HEADER)) return UNAVAILABLE;
  try {
    return await loadUser();
  } catch {
    return UNAVAILABLE; // fail closed: never a user
  }
}

/**
 * The signed-in user, or a redirect to the login page with a safe `next`. During an Auth outage
 * it throws `AuthUnavailableError` instead of redirecting.
 */
export async function requireUser(opts: { next?: string } = {}): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user === UNAVAILABLE) throw new AuthUnavailableError();
  if (!user) redirect(loginUrl(opts.next));
  return user;
}
