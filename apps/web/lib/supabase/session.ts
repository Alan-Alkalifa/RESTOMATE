import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "../env";
import { createDeadlineGuard } from "./fetch";

/** Supabase auth cookies are named `sb-<project ref>-auth-token`, split into `.0`, `.1`, ... */
export function hasSupabaseCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
}

/** The whole refresh, retries included, gets this long. Past it the request goes through as is. */
export const SESSION_REFRESH_DEADLINE_MS = 2500;

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** One line, a code only: no value, no library error text, no stack. */
function logRefresh(code: "session_refresh_timeout" | "session_refresh_error") {
  console.warn(JSON.stringify({ event: "session", code }));
}

/**
 * Refreshes the auth cookies for this request and returns the response to send. This is a
 * refresh only, never authorization: the result of `getClaims()` is not used to allow or deny.
 * Requests without a Supabase cookie are passed through without a network call.
 *
 * It never blocks the request. The refresh has one deadline (`SESSION_REFRESH_DEADLINE_MS`), and
 * the network call itself is aborted at that point, so supabase-js stops retrying too. On a
 * timeout or a network failure the request goes through unchanged: no cookie is read back or
 * written, so there are no half-refreshed cookies. When Auth answers, the cookies it asks for are
 * applied, including the removal of a dead session (refresh_token_not_found), so the browser
 * stops sending it. Every page and action checks access itself.
 *
 * `requestHeaders` are the headers the app will see (set by `proxy.ts`).
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  const passThrough = () => NextResponse.next({ request: { headers: requestHeaders } });
  if (!hasSupabaseCookie(request)) return passThrough();

  const guard = createDeadlineGuard(SESSION_REFRESH_DEADLINE_MS);
  let closed = false; // After the deadline, nothing from the refresh may touch the request.
  const buffered: CookieToSet[] = [];
  let cacheHeaders: Record<string, string> = {};

  try {
    const { url, publishableKey } = getSupabaseEnv();
    const supabase = createServerClient(url, publishableKey, {
      // One deadline for the whole refresh, retries included (see `./fetch`).
      global: { fetch: guard.fetch },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          if (closed) return;
          buffered.push(...cookiesToSet);
          cacheHeaders = { ...cacheHeaders, ...headers };
        },
      },
    });

    // Completed, with a session or with an auth error: either way supabase-js has decided what
    // the cookies should be (an error such as refresh_token_not_found makes it clear them).
    const outcome = await guard.run(() => supabase.auth.getClaims());
    closed = true;

    // Only a deadline or a network failure drops the buffered cookies.
    if (outcome.status !== "done") {
      logRefresh(
        outcome.status === "timeout" ? "session_refresh_timeout" : "session_refresh_error",
      );
      return passThrough();
    }
  } catch {
    closed = true;
    logRefresh("session_refresh_error");
    return passThrough();
  }

  if (buffered.length === 0) return passThrough();

  // Make the refreshed cookies visible to this request's render, then send them to the browser.
  for (const { name, value } of buffered) request.cookies.set(name, value);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { name, value, options } of buffered) response.cookies.set(name, value, options);
  // The response carries a session token: a CDN must never cache it.
  for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
  return response;
}
