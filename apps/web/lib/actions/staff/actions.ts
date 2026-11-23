"use server";

import {
  type ActionResult,
  UNAVAILABLE,
  fail,
  getCurrentUser,
  getOrgContext,
  ok,
  refreshMemberAccess,
  requirePermission,
} from "../../auth";
import { createAdminClient } from "../../supabase/admin";
import { createClient } from "../../supabase/server";
import { sendInvitationEmail } from "./email";
import { staffErrorResult } from "./errors";
import {
  acceptSchema,
  changeRoleSchema,
  fieldErrorsOf,
  inviteSchema,
  invitationRefSchema,
  listInvitationsSchema,
  memberRefSchema,
  readInput,
  setLocationsSchema,
} from "./schemas";
import { newInvitationToken } from "./tokens";

/*
 * Staff Server Actions (M0-BE-22). Every action except `acceptInvitation` first calls
 * `getOrgContext` + `requirePermission("staff.manage")` on the server (S3 from M0-BE-11 QA: the
 * database guards don't stop a peer acting on a peer). Each returns one `ActionResult` with codes
 * and message keys only. Changes are audited by the database. Nothing is logged here.
 * `input` is a `FormData` or a plain object.
 */

/** The caller's context in the org, refused unless they hold staff.manage. */
async function managerOf(orgId: string) {
  const r = await getOrgContext({ orgId });
  if (!r.ok) return { ok: false as const, result: fail(r.reason) };
  const denied = requirePermission(r.ctx, "staff.manage");
  if (!denied.ok) return { ok: false as const, result: fail("forbidden") };
  return { ok: true as const, ctx: r.ctx };
}

/**
 * Accept an invitation by its token (from the email link). Needs a signed-in user whose confirmed
 * email matches the invitation; no staff.manage (the invitee is not a member yet). One generic
 * `invalid_token` for an unknown, used, revoked or expired link.
 */
export async function acceptInvitation(
  input: unknown,
): Promise<ActionResult<{ orgId: string; slug: string }>> {
  const parsed = acceptSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("invalid_token");

  const user = await getCurrentUser();
  if (user === UNAVAILABLE) return fail("unavailable");
  if (!user) return fail("unauthenticated");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: parsed.data.token });
  if (error) return staffErrorResult(error);
  const row = data?.[0];
  if (!row) return fail("unknown");

  refreshMemberAccess(row.joined_org_id, user.id);
  return ok({ orgId: row.joined_org_id, slug: row.joined_org_slug });
}

/** Replace a member's locations (the `set_member_locations` RPC checks the org and the rules). */
export async function setMemberLocations(input: unknown): Promise<ActionResult> {
  const parsed = setLocationsSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const { orgId, memberId, locationIds } = parsed.data;

  const manager = await managerOf(orgId);
  if (!manager.ok) return manager.result;

  const supabase = await createClient();
  const member = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("id", memberId)
    .maybeSingle();
  if (member.error) return staffErrorResult(member.error);
  if (!member.data) return fail("forbidden"); // as the RPC answers: not one of this org's members

  const { error } = await supabase.rpc("set_member_locations", {
    p_member_id: memberId,
    p_location_ids: locationIds,
  });
  if (error) return staffErrorResult(error);
  refreshMemberAccess(orgId, member.data.user_id);
  return ok();
}

/*
 * Reads of `staff_invitations` use the service role, only AFTER the caller was authorized
 * (`managerOf`): that table has no client read access. They only look up what the action needs and
 * always pin the org the caller manages. Roles are read as the user (RLS lets members read them).
 */

type EmailOutcome = { invitationId: string; emailSent: boolean };

/** A role's name, read as the user: members can read their org's roles (RLS). */
async function roleName(orgId: string, roleId: string): Promise<string | null> {
  const { data } = await (
    await createClient()
  )
    .from("roles")
    .select("name")
    .eq("org_id", orgId)
    .eq("id", roleId)
    .maybeSingle();
  return data?.name ?? null;
}

/** An open invitation of THIS org, or null (unknown, another org's, closed: one answer). */
async function openInvitation(orgId: string, invitationId: string) {
  const { data, error } = await createAdminClient()
    .from("staff_invitations")
    .select("id, org_id, email, role_id, accepted_at, revoked_at")
    .eq("id", invitationId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return { error } as const;
  if (!data) return { invitation: null } as const;
  return { invitation: data } as const;
}

/**
 * Email one invitation. A failed email never undoes the invitation (the row exists and holds a
 * staff slot): the caller reports `emailSent: false` and the manager resends.
 */
async function emailInvitation(input: {
  invitationId: string;
  email: string;
  token: string;
  orgId: string;
  orgName: string;
  roleId: string | null;
}): Promise<boolean> {
  const role = input.roleId ? await roleName(input.orgId, input.roleId) : null;
  const sent = await sendInvitationEmail({
    invitationId: input.invitationId,
    to: input.email,
    token: input.token,
    orgName: input.orgName,
    roleName: role ?? "a team member",
  });
  return sent.ok;
}

/**
 * Invite someone by email with a role and locations (or all locations). The token is made here,
 * only its SHA-256 goes to the database, and the raw token exists in the email alone. The
 * database refuses a role or permission the caller lacks, a full plan, a member's address, and a
 * second open invitation for the same address.
 */
export async function inviteStaff(input: unknown): Promise<ActionResult<EmailOutcome>> {
  const parsed = inviteSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const v = parsed.data;

  const manager = await managerOf(v.orgId);
  if (!manager.ok) return manager.result;

  const { token, tokenHash } = await newInvitationToken();
  const supabase = await createClient();
  const { data: invitationId, error } = await supabase.rpc("create_staff_invitation", {
    p_org_id: v.orgId,
    p_email: v.email,
    p_role_id: v.roleId,
    p_token_hash: tokenHash,
    p_all_locations: v.allLocations,
    p_location_ids: v.allLocations ? [] : v.locationIds,
  });
  if (error) return staffErrorResult(error);
  if (!invitationId) return fail("unknown");

  const emailSent = await emailInvitation({
    invitationId,
    email: v.email,
    token,
    orgId: v.orgId,
    orgName: manager.ctx.org.name,
    roleId: v.roleId,
  });
  return ok({ invitationId, emailSent });
}

/**
 * Resend an open invitation: the old one is revoked and a new one made with a NEW token and a new
 * email key (so the old link stops working). Returns the new invitation's ID.
 */
export async function resendInvitation(input: unknown): Promise<ActionResult<EmailOutcome>> {
  const parsed = invitationRefSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const { orgId, invitationId } = parsed.data;

  const manager = await managerOf(orgId);
  if (!manager.ok) return manager.result;

  const found = await openInvitation(orgId, invitationId);
  if ("error" in found) return fail("unavailable");
  if (!found.invitation) return fail("forbidden");
  const old = found.invitation;
  if (old.accepted_at || old.revoked_at)
    return fail("conflict", { form: ["staff.invitation.closed"] });

  const { token, tokenHash } = await newInvitationToken();
  const supabase = await createClient();
  const { data: newId, error } = await supabase.rpc("resend_staff_invitation", {
    p_invitation_id: invitationId,
    p_new_token_hash: tokenHash,
  });
  if (error) return staffErrorResult(error);
  if (!newId) return fail("unknown");

  const emailSent = await emailInvitation({
    invitationId: newId,
    email: old.email,
    token,
    orgId,
    orgName: manager.ctx.org.name,
    roleId: old.role_id,
  });
  return ok({ invitationId: newId, emailSent });
}

/** Revoke an open invitation: its link stops working. */
export async function revokeInvitation(input: unknown): Promise<ActionResult> {
  const parsed = invitationRefSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const { orgId, invitationId } = parsed.data;

  const manager = await managerOf(orgId);
  if (!manager.ok) return manager.result;

  const found = await openInvitation(orgId, invitationId);
  if ("error" in found) return fail("unavailable");
  if (!found.invitation) return fail("forbidden");

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_staff_invitation", {
    p_invitation_id: invitationId,
  });
  if (error) return staffErrorResult(error);
  return ok();
}

/** Nobody changes their own role or status: answered here so the screen can say so. */
const SELF = { form: ["staff.member.self"] };

/** The user ID of a member of this org (the manager's own RLS view), or null. */
async function memberUserId(orgId: string, memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("id", memberId)
    .maybeSingle();
  if (error) return { error } as const;
  return { userId: data?.user_id ?? null } as const;
}

/** Change a member's role. Not your own; only an Owner gives or takes Owner (the database says). */
export async function changeMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = changeRoleSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const { orgId, memberId, roleId } = parsed.data;

  const manager = await managerOf(orgId);
  if (!manager.ok) return manager.result;
  const member = await memberUserId(orgId, memberId);
  if ("error" in member) return staffErrorResult(member.error);
  if (!member.userId) return fail("forbidden");
  if (member.userId === manager.ctx.user.id) return fail("forbidden", SELF);

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_member_role", {
    p_member_id: memberId,
    p_role_id: roleId,
  });
  if (error) return staffErrorResult(error);
  refreshMemberAccess(orgId, member.userId);
  return ok();
}

async function setStatus(input: unknown, status: "active" | "deactivated"): Promise<ActionResult> {
  const parsed = memberRefSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const { orgId, memberId } = parsed.data;

  const manager = await managerOf(orgId);
  if (!manager.ok) return manager.result;
  const member = await memberUserId(orgId, memberId);
  if ("error" in member) return staffErrorResult(member.error);
  if (!member.userId) return fail("forbidden");
  if (member.userId === manager.ctx.user.id) return fail("forbidden", SELF);

  const supabase = await createClient();
  const { data: userId, error } = await supabase.rpc("set_member_status", {
    p_member_id: memberId,
    p_status: status,
  });
  if (error) return staffErrorResult(error);
  // Deactivating also deleted the user's sessions, in the same transaction. A token already issued
  // lasts up to an hour, but `getMembership` refuses a deactivated member on every request.
  refreshMemberAccess(orgId, userId ?? member.userId);
  return ok();
}

/** Deactivate a member and sign them out everywhere. Never yourself; never the last Owner. */
export async function deactivateMember(input: unknown): Promise<ActionResult> {
  return setStatus(input, "deactivated");
}

/** Reactivate a deactivated member (takes a staff slot; never your own row). */
export async function reactivateMember(input: unknown): Promise<ActionResult> {
  return setStatus(input, "active");
}

/*
 * Listing invitations. The signed-in role has no read access to `staff_invitations`, so this is a
 * server read: `staff.manage` first, then the service role, pinned to the caller's org, with an
 * explicit column list. `token_hash` is never selected and nothing secret is returned.
 */

export type InvitationStatus = "open" | "expired" | "accepted" | "revoked";

export type InvitationRow = {
  id: string;
  email: string;
  /** Null on a closed invitation whose role was deleted afterwards. */
  roleId: string | null;
  roleName: string | null;
  allLocations: boolean;
  /** Empty when `allLocations` is true. */
  locationIds: string[];
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  status: InvitationStatus;
};

const INVITATION_COLUMNS =
  "id, email, role_id, all_locations, created_at, expires_at, accepted_at, revoked_at";

function statusOf(
  row: { accepted_at: string | null; revoked_at: string | null; expires_at: string },
  now: number,
): InvitationStatus {
  if (row.accepted_at) return "accepted";
  if (row.revoked_at) return "revoked";
  return new Date(row.expires_at).getTime() > now ? "open" : "expired";
}

/**
 * The org's invitations: open ones first (newest first), then expired ones, then accepted and
 * revoked ones (newest first), at most `limit` rows (default 100, at most 200).
 */
export async function listInvitations(
  input: unknown,
): Promise<ActionResult<{ invitations: InvitationRow[] }>> {
  const parsed = listInvitationsSchema.safeParse(readInput(input));
  if (!parsed.success) return fail("validation", fieldErrorsOf(parsed.error));
  const { orgId, limit } = parsed.data;

  const manager = await managerOf(orgId);
  if (!manager.ok) return manager.result;
  const org = manager.ctx.org.id; // the verified org, never the caller's value from here on

  const admin = createAdminClient();
  const unclosed = await admin
    .from("staff_invitations")
    .select(INVITATION_COLUMNS)
    .eq("org_id", org)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unclosed.error) return fail("unavailable");

  let rows = unclosed.data ?? [];
  if (rows.length < limit) {
    const closed = await admin
      .from("staff_invitations")
      .select(INVITATION_COLUMNS)
      .eq("org_id", org)
      .or("accepted_at.not.is.null,revoked_at.not.is.null")
      .order("created_at", { ascending: false })
      .limit(limit - rows.length);
    if (closed.error) return fail("unavailable");
    rows = [...rows, ...(closed.data ?? [])];
  }
  if (rows.length === 0) return ok({ invitations: [] });

  const ids = rows.map((r) => r.id);
  const roleIds = [...new Set(rows.map((r) => r.role_id).filter((r): r is string => r !== null))];
  const [locations, roles] = await Promise.all([
    admin
      .from("staff_invitation_locations")
      .select("invitation_id, location_id")
      .eq("org_id", org)
      .in("invitation_id", ids),
    roleIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : (await createClient()).from("roles").select("id, name").eq("org_id", org).in("id", roleIds),
  ]);
  if (locations.error || roles.error) return fail("unavailable");

  const locationsOf = new Map<string, string[]>();
  for (const l of locations.data ?? []) {
    locationsOf.set(l.invitation_id, [...(locationsOf.get(l.invitation_id) ?? []), l.location_id]);
  }
  const nameOf = new Map((roles.data ?? []).map((r) => [r.id, r.name]));

  const now = Date.now();
  const rank = { open: 0, expired: 1, accepted: 2, revoked: 2 } as const;
  const invitations = rows
    .map((r): InvitationRow => ({
      id: r.id,
      email: r.email,
      roleId: r.role_id,
      roleName: r.role_id ? (nameOf.get(r.role_id) ?? null) : null,
      allLocations: r.all_locations,
      locationIds: locationsOf.get(r.id) ?? [],
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      acceptedAt: r.accepted_at,
      revokedAt: r.revoked_at,
      status: statusOf(r, now),
    }))
    // A stable sort keeps the newest-first order inside each group.
    .sort((a, b) => rank[a.status] - rank[b.status]);
  return ok({ invitations });
}
