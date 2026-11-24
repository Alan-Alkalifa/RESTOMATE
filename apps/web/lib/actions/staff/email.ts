import "server-only";
import { getAppEnv } from "../../env";
import { sendEmail, type SendResult } from "../../email";
import { renderInvitationEmail } from "../../email/templates/invitation";

/** Where an invitation link lands. The page (REYKI) reads `token` and calls `acceptInvitation`. */
export const ACCEPT_INVITATION_PATH = "/invite/accept";

/** The link in the email: the app's own URL (never a caller's host) + the accept path + token. */
export function acceptInvitationUrl(token: string): string {
  const url = new URL(ACCEPT_INVITATION_PATH, getAppEnv().NEXT_PUBLIC_APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
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
