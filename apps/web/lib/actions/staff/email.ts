import "server-only";
import { getAppEnv } from "../../env";
import { sendEmail, type SendResult } from "../../email";

/** Where an invitation link lands. The page (REYKI) reads `token` and calls `acceptInvitation`. */
export const ACCEPT_INVITATION_PATH = "/invite/accept";

/** The link in the email: the app's own URL (never a caller's host) + the accept path + token. */
export function acceptInvitationUrl(token: string): string {
  const url = new URL(ACCEPT_INVITATION_PATH, getAppEnv().NEXT_PUBLIC_APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

export type InvitationEmailInput = { orgName: string; roleName: string; acceptUrl: string };

/**
 * PLACEHOLDER body, plain text with the link. REYKI replaces this one function with the themed,
 * translated template (M0-FE-10). It must return a subject, html and text, and nothing else.
 */
export function renderInvitationEmail(input: InvitationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  // A control character or line separator in a subject could start a new header line.
  const subject = `You're invited to ${input.orgName} on Restomate`.replace(
    /[\p{Cc}\u2028\u2029]/gu,
    " ",
  );
  const text = `You're invited to join ${input.orgName} as ${input.roleName}.\n\nAccept: ${input.acceptUrl}\n\nThe link works once and expires in 7 days.`;
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const html = `<p>You're invited to join ${esc(input.orgName)} as ${esc(input.roleName)}.</p><p><a href="${esc(input.acceptUrl)}">Accept the invitation</a></p><p>The link works once and expires in 7 days.</p>`;
  return { subject, html, text };
}

/**
 * Send one invitation. The idempotency key is per invitation row, so a retry of this email never
 * sends twice and a resend (a new row) always gets a new key. The raw token is in the body only.
 */
export async function sendInvitationEmail(input: {
  invitationId: string;
  to: string;
  token: string;
  orgName: string;
  roleName: string;
}): Promise<SendResult> {
  const body = renderInvitationEmail({
    orgName: input.orgName,
    roleName: input.roleName,
    acceptUrl: acceptInvitationUrl(input.token),
  });
  return sendEmail({
    kind: "staff_invitation",
    referenceId: input.invitationId,
    idempotencyKey: invitationEmailKey(input.invitationId),
    to: input.to,
    ...body,
  });
}

export const invitationEmailKey = (invitationId: string) => `staff_invitation/${invitationId}`;
