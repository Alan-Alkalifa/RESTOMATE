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
 * Reads with the service role, only AFTER the caller was authorized (`managerOf`): the staff
 * tables have no client read access for invitations and roles. They only look up what the action
 * needs (a role's name, an invitation's address) and always pin the org the caller manages.
 */

type EmailOutcome = { invitationId: string; emailSent: boolean };

async function roleName(orgId: string, roleId: string): Promise<string | null> {
  const { data } = await createAdminClient()
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
