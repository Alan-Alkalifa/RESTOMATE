import "server-only";
import type { Database } from "@restomate/db";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "../env";
import { type DeadlineGuard, createDeadlineGuard } from "./fetch";

/**
 * An Auth client that never reads or writes a cookie: publishable key, implicit flow, no session
 * storage. For the calls that send an email and must answer the same whoever the address belongs
 * to (signup, password-reset request).
 *
 * Why: `@supabase/ssr` always uses the PKCE flow, so `signUp` and `resetPasswordForEmail` set a
 * code-verifier cookie for a new address and CLEAR it when GoTrue refuses an existing one. That
 * difference in the response headers tells a caller who has an account (QA S3 on #42). Our email
 * links use `token_hash` + `verifyOtp`, which needs no verifier, so these calls don't need PKCE.
 * Signs nobody in and keeps nothing between calls; create one per request.
 */
export function createStatelessAuthClient(guard: DeadlineGuard = createDeadlineGuard()) {
  const { url, publishableKey } = getSupabaseEnv();
  return createSupabaseClient<Database>(url, publishableKey, {
    global: { fetch: guard.fetch },
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
