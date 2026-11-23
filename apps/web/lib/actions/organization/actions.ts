"use server";

import type { Database } from "@restomate/db";
import {
  type ActionResult,
  UNAVAILABLE,
  fail,
  getCurrentUser,
  ok,
  refreshMemberAccess,
} from "../../auth";
import { protectOrg } from "../../arcjet/organization";
import { createClient } from "../../supabase/server";
import { createOrgErrorResult } from "./errors";
import {
  type SlugReason,
  SLUG_REASONS,
  createOrganizationSchema,
  fieldErrorsOf,
  isValidSlug,
  readInput,
} from "./schemas";

/*
 * Create a restaurant (M0-BE-21). Both actions need a signed-in user, are rate-limited per user
 * and per IP, and return one `ActionResult` (codes and message keys only). Nothing is logged or
 * sent to analytics. `input` is a `FormData` or a plain object; with `useActionState`, wrap it:
 * `(_prev, formData) => createOrganization(formData)`.
 */

type Fns = Database["public"]["Functions"];
type RpcResult<F extends keyof Fns> = Promise<{
  data: Fns[F]["Returns"] | null;
  error: { code?: string; message?: string } | null;
}>;
/** The two RPCs this module calls, typed by the generated database types. */
type OrgRpc = {
  rpc(
    fn: "is_slug_available",
    args: Fns["is_slug_available"]["Args"],
  ): RpcResult<"is_slug_available">;
  rpc(
    fn: "create_organization",
    args: Fns["create_organization"]["Args"],
  ): RpcResult<"create_organization">;
};
const orgDb = async () => (await createClient()) as unknown as OrgRpc;

type SignedIn = { ok: true; userId: string } | { ok: false; result: ReturnType<typeof fail> };

async function signedIn(): Promise<SignedIn> {
  const user = await getCurrentUser();
  if (user === UNAVAILABLE) return { ok: false, result: fail("unavailable") };
  if (!user) return { ok: false, result: fail("unauthenticated") };
  return { ok: true, userId: user.id };
}

async function limited(preset: "slugCheck" | "createOrg", userId: string) {
  const verdict = await protectOrg(preset, { userId });
  if (verdict.allowed) return null;
  return fail(verdict.reason === "rate_limited" ? "rate_limited" : "forbidden");
}

/**
 * Whether a restaurant address (slug) can be used. The same rules as the database; a slug that
 * breaks them is answered here without asking it. `reason` is null when it is available.
 */
export async function checkSlug(
  slug: unknown,
): Promise<ActionResult<{ available: boolean; reason: SlugReason | null }>> {
  if (typeof slug !== "string") return fail("validation", { slug: ["org.slug.invalid"] });

  const auth = await signedIn();
  if (!auth.ok) return auth.result;
  const refused = await limited("slugCheck", auth.userId);
  if (refused) return refused;

  const normalized = slug.trim().toLowerCase();
  if (!isValidSlug(normalized)) return ok({ available: false, reason: "SLUG_INVALID" as const });

  const supabase = await orgDb();
  const { data, error } = await supabase.rpc("is_slug_available", { p_slug: normalized });
  if (error) {
    const mapped = createOrgErrorResult(error);
    return mapped.error.code === "unauthenticated" ? mapped : fail("unavailable");
  }
  const row = data?.[0];
  if (!row) return fail("unavailable");
  if (row.available) return ok({ available: true, reason: null });
  const reason = (SLUG_REASONS as readonly string[]).includes(row.reason)
    ? (row.reason as SlugReason)
    : "SLUG_INVALID"; // an unknown answer is never "available"
  return ok({ available: false, reason });
}

/**
 * Create a restaurant with its first location, and make the caller its Owner (one database
 * transaction). Returns the new org's ID and slug so the page can go straight into it.
 * A second submit of the same form gets `conflict` (SLUG_TAKEN): the slug is unique, so there is
 * never a second org.
 */
export async function createOrganization(
  input: unknown,
): Promise<ActionResult<{ orgId: string; slug: string }>> {
  const parsed = createOrganizationSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));

  const auth = await signedIn();
  if (!auth.ok) return auth.result;
  const refused = await limited("createOrg", auth.userId);
  if (refused) return refused;

  const v = parsed.data;
  const supabase = await orgDb();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: v.name,
    p_slug: v.slug,
    p_timezone: v.timezone,
    p_location_name: v.locationName,
    p_address: v.address,
    p_tax_bps: v.taxBps,
    p_service_charge_bps: v.serviceChargeBps,
    p_tax_on_service: v.taxOnService,
  });
  if (error) return createOrgErrorResult(error);
  const row = data?.[0];
  if (!row) return fail("unknown");

  // The caller is now an Owner there: drop their cached memberships so the org shows at once.
  refreshMemberAccess(row.new_org_id, auth.userId);
  return ok({ orgId: row.new_org_id, slug: row.new_org_slug });
}
