import "server-only";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { UUID } from "./keys";
import { loginUrl } from "./next";

export type AuthUser = { id: string; email: string | null };

/**
 * The signed-in user, or null. The session is verified with `auth.getClaims()` (the JWT is
 * checked, never the bare cookie); `getSession()` is never used for this.
 *
 * `'use cache: private'` reads the cookies, so call it inside `<Suspense>` (Cache Components).
 * In production a private result is not kept across requests, so every action still re-checks.
 * A page must never treat a cached result as proof the user is still signed in.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  "use cache: private";
  cacheLife({ stale: 30 });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || typeof sub !== "string" || !UUID.test(sub)) return null;
    const email = data?.claims?.email;
    return { id: sub, email: typeof email === "string" ? email : null };
  } catch {
    return null; // fail closed
  }
}

/** The signed-in user, or a redirect to the login page with a safe `next`. */
export async function requireUser(opts: { next?: string } = {}): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(opts.next));
  return user;
}
