import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RoleOption } from "./model";

/**
 * The org's roles for the pickers, read as the signed-in user (RLS shows a member only their own
 * org's roles; roles.md "Reading roles"). Null when the read fails: the page shows the error state.
 */
export async function readRoles(orgId: string): Promise<RoleOption[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, is_system")
    .eq("org_id", orgId)
    .order("is_system", { ascending: false })
    .order("name");
  if (error || !data) return null;
  return data.map((r) => ({ id: r.id, name: r.name }));
}
