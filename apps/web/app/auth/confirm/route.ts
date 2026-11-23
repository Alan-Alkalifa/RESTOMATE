import { type NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_AFTER_LOGIN,
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  RESET_PASSWORD_PATH,
  isAuthOutage,
  safeNextPath,
} from "../../../lib/auth";
import { confirmQuerySchema } from "../../../lib/actions/auth/schemas";
import { runAuth } from "../../../lib/actions/auth/shared";
import { createDeadlineGuard } from "../../../lib/supabase/fetch";
import { createClient } from "../../../lib/supabase/server";

/**
 * Email confirmation and password recovery links (M0-BE-20). The email carries `token_hash` and
 * `type`, built on the Site URL by Supabase (the templates use `{{ .SiteURL }}`, never a
 * caller-supplied host). This route verifies the hash, which signs the user in, and sends them on:
 *
 *   recovery  ->  /reset-password          everything else  ->  `next` (a safe same-site path) or /app
 *
 * A bad, expired or used link goes back to the page it belongs to with `?error=invalid_link` (a
 * code, never a message), and an outage with `?error=unavailable`. The redirect stays on the host
 * that received the request, which `proxy.ts` has already checked, and `next` can never leave it.
 *
 * Reading the request makes this handler dynamic (Cache Components: no `dynamic` segment config).
 */

function redirectTo(request: NextRequest, path: string, error?: "invalid_link" | "unavailable") {
  const url = new URL(path, request.nextUrl.origin);
  if (error) url.searchParams.set("error", error);
  // 303: the browser follows with a GET whatever the method was.
  return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest) {
  const parsed = confirmQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  // Read from the raw query, so even a broken recovery link goes back to "forgot password".
  const recovery = request.nextUrl.searchParams.get("type") === "recovery";
  const failedPath = recovery ? FORGOT_PASSWORD_PATH : LOGIN_PATH;
  if (!parsed.success) return redirectTo(request, failedPath, "invalid_link");

  const { token_hash, type } = parsed.data;
  const guard = createDeadlineGuard();
  const supabase = await createClient(guard);
  const outcome = await runAuth(guard, () => supabase.auth.verifyOtp({ type, token_hash }));
  if (outcome.status !== "done") return redirectTo(request, failedPath, "unavailable");
  if (outcome.value.error) {
    return redirectTo(
      request,
      failedPath,
      isAuthOutage(outcome.value.error) ? "unavailable" : "invalid_link",
    );
  }
  return redirectTo(
    request,
    type === "recovery" ? RESET_PASSWORD_PATH : safeNextPath(parsed.data.next, DEFAULT_AFTER_LOGIN),
  );
}
