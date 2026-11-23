import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, getSupabaseEnv } from "../env";

/**
 * Service-role client. It BYPASSES RLS, so use it only where no user session can do the job
 * (webhooks, background jobs, system writes), and only after the caller has been authorized in
 * code. Never pass its result to the browser. It holds no session and reads no cookies.
 */
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getSupabaseAdminEnv();
  return createSupabaseClient(url, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
