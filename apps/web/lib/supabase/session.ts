import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "../env";

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

const FILTERED = Symbol.for("restomate.session.logFilter");
type Filtered = ((...args: unknown[]) => void) & { [FILTERED]?: true };

/**
 * supabase-js logs a transient network failure itself, with `console.warn(err)`: the error text
 * and a stack, from inside its own retry and recovery code. That is library text we must not
 * emit, and it cannot be switched off by an option. This drops exactly those calls (an
 * `AuthRetryableFetchError` as the first argument) and passes every other log through. It wraps
 * each console method once, and wraps again only if something replaced the method.
 */
function filterAuthRetryLogs() {
  for (const method of ["warn", "error"] as const) {
    const original = console[method] as Filtered;
    if (original[FILTERED]) continue;
    const wrapped: Filtered = (...args) => {
      const first = args[0] as { name?: unknown } | undefined;
      if (first && typeof first === "object" && first.name === "AuthRetryableFetchError") return;
      original.apply(console, args);
    };
    wrapped[FILTERED] = true;
    console[method] = wrapped;
  }
}

/**
 * Refreshes the auth cookies for this request and returns the response to send. This is a
 * refresh only, never authorization: the result of `getClaims()` is not used to allow or deny.
 * Requests without a Supabase cookie are passed through without a network call.
 *
 * It never blocks the request. The refresh has one deadline (`SESSION_REFRESH_DEADLINE_MS`), and
 * the network call itself is aborted at that point, so supabase-js stops retrying too. On a
 * timeout or any error the request goes through unchanged: no cookie is read back or written,
 * so there are no half-refreshed cookies. Every page and action checks access itself.
 *
 * `requestHeaders` are the headers the app will see (set by `proxy.ts`).
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  const passThrough = () => NextResponse.next({ request: { headers: requestHeaders } });
  if (!hasSupabaseCookie(request)) return passThrough();

  filterAuthRetryLogs();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false; // After the deadline, nothing from the refresh may touch the request.
  let failNow: () => void = () => {};
  const failed = new Promise<"error">((resolve) => {
    failNow = () => resolve("error");
  });
  const buffered: CookieToSet[] = [];
  let cacheHeaders: Record<string, string> = {};

  try {
    const { url, publishableKey } = getSupabaseEnv();
    const supabase = createServerClient(url, publishableKey, {
      global: {
        // Every Auth call, and each retry, shares the one deadline. A network failure ends the
        // refresh at once, and the abort makes any retry that supabase-js still schedules fail
        // without a network call.
        fetch: async (input, init) => {
          try {
            return await fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, controller.signal])
                : controller.signal,
            });
          } catch (error) {
            // Network failure: end the refresh now. supabase-js would retry with back-off.
            controller.abort();
            failNow();
            throw error;
          }
        },
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          if (closed) return;
          buffered.push(...cookiesToSet);
          cacheHeaders = { ...cacheHeaders, ...headers };
        },
      },
    });

    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, SESSION_REFRESH_DEADLINE_MS);
    });
    const outcome = await Promise.race([
      supabase.auth.getClaims().then((r) => (r.error ? ("error" as const) : ("ok" as const))),
      deadline,
      failed,
    ]);
    closed = true;

    if (outcome === "timeout" || outcome === "error") {
      logRefresh(outcome === "timeout" ? "session_refresh_timeout" : "session_refresh_error");
      return passThrough();
    }
  } catch {
    closed = true;
    logRefresh("session_refresh_error");
    return passThrough();
  } finally {
    clearTimeout(timer);
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
