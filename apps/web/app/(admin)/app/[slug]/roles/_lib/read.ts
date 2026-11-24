import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { RoleView } from "./groups";

/**
 * The org's roles with their permissions, read as the signed-in user (RLS: every member reads their
 * own org's roles, roles.md "Reading roles"). `memberCounts` comes from `listMembers`. Null when a
 * read fails: the page shows the error state, never a partial list.
 */
export async function readRoles(
  orgId: string,
  memberCounts: Map<string, number>,
): Promise<RoleView[] | null> {
  const supabase = await createClient();
  const [roles, perms] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, description, is_system, system_key")
      .eq("org_id", orgId)
      .order("is_system", { ascending: false })
      .order("name"),
    supabase.from("role_permissions").select("role_id, permission_key").eq("org_id", orgId),
  ]);
  if (roles.error || perms.error || !roles.data || !perms.data) return null;

  const byRole = new Map<string, string[]>();
  for (const p of perms.data) {
    byRole.set(p.role_id, [...(byRole.get(p.role_id) ?? []), p.permission_key]);
  }
  return roles.data.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    systemKey: r.system_key,
    permissions: byRole.get(r.id) ?? [],
    memberCount: memberCounts.get(r.id) ?? 0,
  }));
}
