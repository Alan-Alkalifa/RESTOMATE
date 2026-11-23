import "server-only";
import { createAdminClient } from "../supabase/admin";
import { type ActionResult, fail, ok } from "./result";
import { UUID } from "./keys";
import { UNAVAILABLE, getCurrentUser } from "./user";

/**
 * Platform admin check. `platform_admins` has no client access, so this reads it with the
 * service role, by the user ID that `getClaims()` verified. It is never cached, never takes an ID
 * from the client, and any error or doubt is "no" (`unavailable` when Auth cannot be reached, and
 * still a refusal). It does not redirect.
 */
export async function requirePlatformAdmin(): Promise<ActionResult<{ userId: string }>> {
  const user = await getCurrentUser();
  if (user === UNAVAILABLE) return fail("unavailable"); // cannot tell, so no
  if (!user) return fail("unauthenticated");
  if (!UUID.test(user.id)) return fail("not_platform_admin");
  try {
    const { data, error } = await createAdminClient()
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data || data.user_id !== user.id) return fail("not_platform_admin");
    return ok({ userId: user.id });
  } catch {
    return fail("not_platform_admin");
  }
}
