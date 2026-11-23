"use server";

import {
  type ActionResult,
  UNAVAILABLE,
  fail,
  getCurrentUser,
  getOrgContext,
  ok,
  readMembershipRows,
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
  LOCATIONS_LIMIT,
  MAX_OWNED_ORGS,
  isValidSlug,
  listLocationsSchema,
  normalizeSlug,
  readInput,
} from "./schemas";

/*
 * Create a restaurant (M0-BE-21). Both actions need a signed-in user, are rate-limited per user
 * and per IP, and return one `ActionResult` (codes and message keys only). Nothing is logged or
 * sent to analytics. `input` is a `FormData` or a plain object; with `useActionState`, wrap it:
 * `(_prev, formData) => createOrganization(formData)`.
 */

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

  const normalized = normalizeSlug(slug); // spaces only, as the database trims
  if (!isValidSlug(normalized)) return ok({ available: false, reason: "SLUG_INVALID" as const });

  const supabase = await createClient();
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
  const supabase = await createClient();
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

export type MyOrganization = {
  orgId: string;
  slug: string;
  name: string;
  orgStatus: "active" | "suspended";
  memberStatus: "active" | "deactivated";
  roleId: string;
  /** Null for a custom role. */
  roleKey: string | null;
  roleName: string;
};

/**
 * Every organization the signed-in user belongs to, **including** suspended orgs and deactivated
 * memberships, so the page can show the right notice. Own data only (the database answers for
 * `auth.uid()`): ids, names, statuses and the user's role, nothing about other members. For `/app`
 * (none: create; one: go in; several: pick), the shell's switcher and the create page's cap check.
 *
 * `atCap` is true when the user already owns the most restaurants allowed (active Owner
 * memberships), so the create page can say so before the form. The database stays the authority.
 */
export async function listMyOrganizations(): Promise<
  ActionResult<{
    user: { email: string | null; fullName: string | null };
    organizations: MyOrganization[];
    atCap: boolean;
  }>
> {
  const user = await getCurrentUser();
  if (user === UNAVAILABLE) return fail("unavailable");
  if (!user) return fail("unauthenticated");

  const supabase = await createClient();
  const [memberships, profile] = await Promise.all([
    supabase.rpc("my_org_membership", {}),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (memberships.error || profile.error) return fail("unavailable");

  let rows;
  try {
    rows = readMembershipRows(memberships.data);
  } catch {
    return fail("unavailable"); // an unknown status is never shown as a known one
  }
  const organizations = rows.map((r): MyOrganization => ({
    orgId: r.org_id,
    slug: r.org_slug,
    name: r.org_name,
    orgStatus: r.org_status,
    memberStatus: r.member_status,
    roleId: r.role_id,
    roleKey: r.role_key,
    roleName: r.role_name,
  }));
  const owned = organizations.filter((o) => o.memberStatus === "active" && o.roleKey === "owner");
  return ok({
    user: { email: user.email, fullName: profile.data?.full_name ?? null },
    organizations,
    atCap: owned.length >= MAX_OWNED_ORGS,
  });
}

export type MyLocation = { id: string; name: string; timezone: string };

/**
 * The locations the caller can reach in an org, for the pickers in invite and set-locations. Any
 * active member may call it; the database decides which rows they see (Owner and Manager every
 * location, others only where they work), so nothing is filtered here.
 */
export async function listLocations(
  input: unknown,
): Promise<ActionResult<{ locations: MyLocation[] }>> {
  const parsed = listLocationsSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));

  const context = await getOrgContext({ orgId: parsed.data.orgId });
  if (!context.ok) return fail(context.reason);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, timezone")
    .eq("org_id", context.ctx.org.id) // the verified org, never the caller's value
    .order("name", { ascending: true })
    .limit(LOCATIONS_LIMIT);
  if (error) return fail("unavailable");
  return ok({
    locations: (data ?? []).map((l) => ({ id: l.id, name: l.name, timezone: l.timezone })),
  });
}
