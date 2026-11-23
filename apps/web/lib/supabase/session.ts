import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

/** Supabase auth cookies are named `sb-<project ref>-auth-token`, split into `.0`, `.1`, ... */
export function hasSupabaseCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
}

/**
 * Refreshes the auth cookies for this request and returns the response to send. This is a
 * refresh only, never authorization: the result of `getClaims()` is not used to allow or deny.
 * Requests without a Supabase cookie are passed through without a network call. A refresh
 * failure never blocks the request; every page and action checks access itself.
 *
 * `requestHeaders` are the headers the app will see (set by `proxy.ts`).
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!hasSupabaseCookie(request)) return response;

  try {
    const { url, publishableKey } = getSupabaseEnv();
    const supabase = createServerClient(url, publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, cacheHeaders) {
          // Make the refreshed cookies visible to this request's render, then to the browser.
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // The response carries a session token: a CDN must never cache it.
          for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {
    // Misconfiguration or Auth unreachable: keep serving. Nothing is logged (no values).
  }
  return response;
}
