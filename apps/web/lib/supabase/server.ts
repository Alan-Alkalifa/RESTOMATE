import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and route handlers. It acts as the
 * signed-in user, so RLS applies. Create one per request; never keep it in a module variable.
 * `cookies()` is dynamic: call this inside `<Suspense>` (Cache Components).
 *
 * Verify a session with `auth.getClaims()`, never `auth.getSession()`: the cookie is not trusted.
 */
export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot write cookies. `proxy.ts` refreshes
          // the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
