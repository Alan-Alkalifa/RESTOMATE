"use server";

import {
  type ActionResult,
  type OrgContext,
  fail,
  getOrgContext,
  ok,
  refreshMemberAccess,
  requireFeature,
  requirePermission,
} from "../../auth";
import { createClient } from "../../supabase/server";
import { roleErrorResult } from "./errors";
import {
  createRoleSchema,
  deleteRoleSchema,
  fieldErrorsOf,
  readRoleInput,
  updateRoleSchema,
} from "./schemas";

/*
 * Custom roles (M0-BE-23). Each action: parse with the shared schema, find the caller's
 * membership (`getOrgContext`), `requirePermission("staff.manage")`, and (create, update) the
 * package feature `custom_roles`. The write is one database RPC that runs as the caller, so the
 * database's own rules hold whatever this code does: nobody grants a permission they lack
 * (ESCALATION_DENIED), system roles stay as they are, a role someone holds can't be deleted. The
 * role, its permissions and the audit row change in one transaction (the audit comes from the
 * database triggers). `input` is a `FormData` or a plain object; with `useActionState`, wrap it:
 * `(_prev, formData) => createRole(formData)`. Results carry codes and message keys only; nothing
 * is logged or sent to analytics.
 *
 * Deleting needs no package feature, so an org that dropped to a plan without custom roles can
 * still remove them. A member's permissions are cached for up to 30 seconds (private cache): a
 * change to a role shows for the caller at once and for others within that time. The database
 * checks every request, so a stale cache never grants more than the role allows.
 */

type RpcResult<T> = Promise<{ data: T | null; error: { code?: string; message?: string } | null }>;
/** The three RPCs this module calls. Null means "keep" for update (the generated types say string). */
type RoleRpc = {
  rpc(
    fn: "create_role",
    args: {
      p_org_id: string;
      p_name: string;
      p_description: string | null;
      p_permission_keys: string[];
    },
  ): RpcResult<string>;
  rpc(
    fn: "update_role",
    args: {
      p_role_id: string;
      p_name: string | null;
      p_description: string | null;
      p_permission_keys: string[] | null;
    },
  ): RpcResult<undefined>;
  rpc(fn: "delete_role", args: { p_role_id: string }): RpcResult<undefined>;
};
const roleDb = async () => (await createClient()) as unknown as RoleRpc;

type Org = { orgId?: string; orgSlug?: string };
const refOf = (v: Org) => (v.orgId !== undefined ? { orgId: v.orgId } : { slug: v.orgSlug! });

/** The caller's context in the org, with `staff.manage` (and the feature, when the action needs it). */
async function manager(
  org: Org,
  feature: boolean,
): Promise<{ ok: true; ctx: OrgContext } | { ok: false; result: ReturnType<typeof fail> }> {
  const r = await getOrgContext(refOf(org));
  if (!r.ok) return { ok: false, result: fail(r.reason) };
  const denied = requirePermission(r.ctx, "staff.manage");
  if (!denied.ok) return { ok: false, result: denied };
  if (feature) {
    const missing = requireFeature(r.ctx, "custom_roles");
    if (!missing.ok)
      return {
        ok: false,
        result: fail("feature_unavailable", { form: ["roles.feature_unavailable"] }),
      };
  }
  return { ok: true, ctx: r.ctx };
}

/** Permission keys the caller does not hold. The database refuses them too; this answers first. */
const notHeld = (ctx: OrgContext, keys: readonly string[]) =>
  keys.filter((k) => !ctx.permissions.has(k));

/**
 * Create a custom role with the given permissions. The caller can only give permissions they hold
 * themselves. A name that is the same as another role's once cleaned (case, spaces, invisible
 * characters) is `conflict` with a `name` field error.
 */
export async function createRole(input: unknown): Promise<ActionResult<{ roleId: string }>> {
  const parsed = createRoleSchema.safeParse(readRoleInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const v = parsed.data;

  const access = await manager(v, true);
  if (!access.ok) return access.result;
  if (notHeld(access.ctx, v.permissions).length > 0) {
    return fail("forbidden", { permissions: ["roles.permissions.not_held"] });
  }

  const supabase = await roleDb();
  const { data, error } = await supabase.rpc("create_role", {
    p_org_id: access.ctx.org.id,
    p_name: v.name,
    p_description: v.description ?? null,
    p_permission_keys: v.permissions,
  });
  if (error) return roleErrorResult(error);
  if (!data) return fail("unknown");

  refreshMemberAccess(access.ctx.org.id, access.ctx.user.id);
  return ok({ roleId: data });
}

/**
 * Change a custom role. A field that is not sent keeps its value; `description: ""` clears the
 * description; `permissions` is the full new list (`[]` removes them all). The caller must hold
 * every permission the role has now and every one they add. System roles are refused.
 */
export async function updateRole(input: unknown): Promise<ActionResult<void>> {
  const parsed = updateRoleSchema.safeParse(readRoleInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const v = parsed.data;

  const access = await manager(v, true);
  if (!access.ok) return access.result;
  if (v.permissions && notHeld(access.ctx, v.permissions).length > 0) {
    return fail("forbidden", { permissions: ["roles.permissions.not_held"] });
  }

  const supabase = await roleDb();
  const { error } = await supabase.rpc("update_role", {
    p_role_id: v.roleId,
    p_name: v.name ?? null,
    p_description: v.description ?? null,
    p_permission_keys: v.permissions ?? null,
  });
  if (error) return roleErrorResult(error);

  refreshMemberAccess(access.ctx.org.id, access.ctx.user.id);
  return ok();
}

/**
 * Delete a custom role. `conflict` (`roles.in_use`) while a member holds it or an open invitation
 * names it; closed invitations don't block it. System roles are refused. No package feature is
 * needed.
 */
export async function deleteRole(input: unknown): Promise<ActionResult<void>> {
  const parsed = deleteRoleSchema.safeParse(readRoleInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const v = parsed.data;

  const access = await manager(v, false);
  if (!access.ok) return access.result;

  const supabase = await roleDb();
  const { error } = await supabase.rpc("delete_role", { p_role_id: v.roleId });
  if (error) return roleErrorResult(error);

  refreshMemberAccess(access.ctx.org.id, access.ctx.user.id);
  return ok();
}
