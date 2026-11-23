import "server-only";
import { cacheLife, cacheTag, updateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "../supabase/server";
import { type AccessDenied, type ActionResult, fail, ok } from "./result";
import {
  type FeatureKey,
  FEATURE_KEYS,
  type PermissionKey,
  PERMISSION_KEYS,
  UUID,
  memberTag,
  packageTag,
  userMembershipsTag,
} from "./keys";
import { type AuthUser, UNAVAILABLE, getCurrentUser } from "./user";

/*
 * Why these are `'use cache: private'` and not `'use cache'`: the database functions behind them
 * (`my_org_membership`, `my_permissions`, `get_org_package`) answer for `auth.uid()`, which is the
 * caller's JWT. A shared cache would have to rebuild their checks with the service role, and a
 * mistake there would show one tenant's data to another. Private caches reuse a result within a
 * request and never share it. The explicit user and org ID arguments, and the tags, hold IDs only.
 */

const membershipRow = z.object({
  org_id: z.string().regex(UUID),
  org_slug: z.string(),
  org_name: z.string(),
  org_status: z.enum(["active", "suspended"]),
  member_id: z.string().regex(UUID),
  member_status: z.enum(["active", "deactivated"]),
  role_id: z.string().regex(UUID),
  role_key: z.string().nullable(),
  role_name: z.string(),
});
export type MembershipRow = z.infer<typeof membershipRow>;

const packageRow = z.object({
  package_key: z.string(),
  package_name: z.string(),
  subscription_status: z.string(),
  trial_ends_at: z.string().nullable(),
  current_period_end: z.string().nullable(),
  max_locations: z.number().nullable(),
  max_staff: z.number().nullable(),
  max_tables: z.number().nullable(),
  features: z.record(z.string(), z.boolean()),
});
export type OrgPackage = z.infer<typeof packageRow>;

async function loadMemberships(userId: string): Promise<MembershipRow[]> {
  "use cache: private";
  cacheTag(userMembershipsTag(userId));
  cacheLife({ stale: 30 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_org_membership", { p_org_id: null });
  if (error) throw new Error("memberships_unavailable"); // thrown, so a failure is never cached
  return z.array(membershipRow).parse(data ?? []);
}

async function loadPermissions(userId: string, orgId: string): Promise<string[]> {
  "use cache: private";
  cacheTag(memberTag(orgId, userId));
  cacheLife({ stale: 30 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_permissions", { p_org_id: orgId });
  if (error) throw new Error("permissions_unavailable");
  return z.array(z.string()).parse(data ?? []);
}

async function loadPackage(userId: string, orgId: string): Promise<OrgPackage | null> {
  "use cache: private";
  cacheTag(packageTag(orgId), memberTag(orgId, userId));
  cacheLife({ stale: 30 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_package", { p_org_id: orgId });
  if (error) throw new Error("package_unavailable");
  const rows = z.array(packageRow).parse(data ?? []);
  return rows[0] ?? null; // no running subscription: no package, so no feature
}

export type OrgRef = { orgId: string } | { slug: string };

export type Membership = Pick<
  MembershipRow,
  "org_id" | "org_slug" | "org_name" | "member_id" | "role_id" | "role_key" | "role_name"
>;
export type MembershipResult =
  | { ok: true; membership: Membership }
  | { ok: false; reason: Exclude<AccessDenied, "unauthenticated"> };

/**
 * Whether `userId` may use the org. Only an active member of an active org passes. A suspended org
 * wins over a deactivated member, so the right notice is shown. An unknown org, another tenant's
 * org and a non-member are the same answer, so nothing tells them apart.
 */
export async function getMembership(userId: string, ref: OrgRef): Promise<MembershipResult> {
  let rows: MembershipRow[];
  try {
    rows = await loadMemberships(userId);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const row = rows.find((r) => ("orgId" in ref ? r.org_id === ref.orgId : r.org_slug === ref.slug));
  if (!row) return { ok: false, reason: "no_membership" };
  if (row.org_status !== "active") return { ok: false, reason: "org_suspended" };
  if (row.member_status !== "active") return { ok: false, reason: "member_deactivated" };
  return {
    ok: true,
    membership: {
      org_id: row.org_id,
      org_slug: row.org_slug,
      org_name: row.org_name,
      member_id: row.member_id,
      role_id: row.role_id,
      role_key: row.role_key,
      role_name: row.role_name,
    },
  };
}

export type OrgContext = {
  user: AuthUser;
  org: { id: string; slug: string; name: string };
  member: { id: string; roleId: string; roleKey: string | null; roleName: string };
  /** The permission keys the member holds. The Owner holds all of them (implicit, from the database). */
  permissions: ReadonlySet<string>;
  /** Null when the org has no running subscription. */
  package: OrgPackage | null;
};
export type OrgContextResult = { ok: true; ctx: OrgContext } | { ok: false; reason: AccessDenied };

/**
 * Everything a page or action needs about the caller in one org. It never redirects: a page maps
 * `reason` to the login redirect, the suspended notice or a 404, and an action returns it.
 * Nothing but the reason leaves on a refusal.
 */
export async function getOrgContext(ref: OrgRef): Promise<OrgContextResult> {
  const user = await getCurrentUser();
  if (user === UNAVAILABLE) return { ok: false, reason: "unavailable" };
  if (!user) return { ok: false, reason: "unauthenticated" };

  const result = await getMembership(user.id, ref);
  if (!result.ok) return { ok: false, reason: result.reason };
  const { membership } = result;

  try {
    const [permissions, pkg] = await Promise.all([
      loadPermissions(user.id, membership.org_id),
      loadPackage(user.id, membership.org_id),
    ]);
    return {
      ok: true,
      ctx: {
        user,
        org: { id: membership.org_id, slug: membership.org_slug, name: membership.org_name },
        member: {
          id: membership.member_id,
          roleId: membership.role_id,
          roleKey: membership.role_key,
          roleName: membership.role_name,
        },
        permissions: new Set(permissions),
        package: pkg,
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Whether the member holds the permission. An unknown key is never held. */
export function hasPermission(ctx: OrgContext, permission: PermissionKey): boolean {
  return (
    (PERMISSION_KEYS as readonly string[]).includes(permission) && ctx.permissions.has(permission)
  );
}

/** The check every action makes: `const denied = requirePermission(ctx, "x.y"); if (!denied.ok) return denied;` */
export function requirePermission(ctx: OrgContext, permission: PermissionKey): ActionResult<void> {
  return hasPermission(ctx, permission) ? ok() : fail("forbidden");
}

/** Whether the org's package includes the feature. No package, no feature. */
export function hasFeature(ctx: OrgContext, feature: FeatureKey): boolean {
  return (
    (FEATURE_KEYS as readonly string[]).includes(feature) && ctx.package?.features[feature] === true
  );
}

/** For an action behind a paid feature. */
export function requireFeature(ctx: OrgContext, feature: FeatureKey): ActionResult<void> {
  return hasFeature(ctx, feature) ? ok() : fail("feature_unavailable");
}

/**
 * Refresh what a change touches. Call from the Server Action that changed it
 * (`updateTag` works only there; a route handler uses `revalidateTag`).
 */
export function refreshMemberAccess(orgId: string, userId: string) {
  updateTag(userMembershipsTag(userId));
  updateTag(memberTag(orgId, userId));
}
export function refreshOrgPackage(orgId: string) {
  updateTag(packageTag(orgId));
}
