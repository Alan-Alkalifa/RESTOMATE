import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, getSupabaseEnv } from "../env";
import { type DeadlineGuard, createDeadlineGuard } from "./fetch";

/**
 * Service-role client. It BYPASSES RLS, so use it only where no user session can do the job
 * (webhooks, background jobs, system writes), and only after the caller has been authorized in
 * code. Never pass its result to the browser. It holds no session and reads no cookies.
 * Every call has a short deadline, so a Supabase outage fails fast instead of hanging (`./fetch`).
 */
export function createAdminClient(guard: DeadlineGuard = createDeadlineGuard()) {
  const { url } = getSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getSupabaseAdminEnv();
  return createSupabaseClient(url, SUPABASE_SERVICE_ROLE_KEY, {
    global: { fetch: guard.fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
