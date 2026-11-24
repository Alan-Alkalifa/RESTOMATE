/**
 * The staff invitation email (M0-FE-10): the Restomate layout of DESIGN.md §7.7 (dominant-50 page, white
 * card, 4 px accent bar, wordmark, secondary-600 button), English then Bahasa Indonesia in one message,
 * system font fallbacks. Pure: it returns `{ subject, html, text }` and sends nothing.
 *
 * Every value is HTML-escaped in the `html` part (org name, role name and the link), the `text` part is
 * plain text, and the subject has no line break or control character. The link must be http(s).
 */

export type InvitationEmailInput = { orgName: string; roleName: string; acceptUrl: string };

const FONT = "'Plus Jakarta Sans', Arial, Helvetica, sans-serif";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** A header must never get a new line from a name. */
const oneLine = (s: string) =>
  s
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function renderInvitationEmail(input: InvitationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  if (!/^https?:\/\//i.test(input.acceptUrl)) throw new Error("invitation_link_invalid");
  const org = oneLine(input.orgName);
  const role = oneLine(input.roleName);
  const subject = `You're invited to ${org} on Restomate / Anda diundang ke ${org} di Restomate`;

  const text = [
    `You're invited to join ${org} as ${role}.`,
    "",
    `Accept: ${input.acceptUrl}`,
    "",
    "The link works once and expires in 7 days. If you weren't expecting this, you can ignore this email.",
    "",
    "---",
    "",
    `Anda diundang untuk bergabung dengan ${org} sebagai ${role}.`,
    "",
    `Terima: ${input.acceptUrl}`,
    "",
    "Tautan hanya berlaku sekali dan kedaluwarsa dalam 7 hari. Jika Anda tidak mengharapkan ini, abaikan email ini.",
  ].join("\n");

  const e = { org: escapeHtml(org), role: escapeHtml(role), url: escapeHtml(input.acceptUrl) };
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFD;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFD;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:#0047AB;">Restomate</td></tr>
<tr><td style="background-color:#FFFFFF;border:1px solid #E2E7F0;border-radius:16px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="4" style="height:4px;line-height:4px;font-size:0;background-color:#C0F03A;">&nbsp;</td></tr>
<tr><td style="padding:32px 28px;font-family:${FONT};color:#0F1B3D;">
<h1 lang="en" style="margin:0 0 12px 0;font-size:22px;line-height:30px;font-weight:700;color:#0F1B3D;">You're invited to ${e.org}</h1>
<p lang="en" style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#0F1B3D;">You've been invited to join ${e.org} as ${e.role}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
<tr><td align="center" style="background-color:#0047AB;border-radius:8px;"><a href="${e.url}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;line-height:24px;font-weight:600;color:#FFFFFF;text-decoration:none;">Accept invitation / Terima undangan</a></td></tr>
</table>
<p lang="en" style="margin:0 0 24px 0;font-size:14px;line-height:20px;color:#626E87;">The link works once and expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
<hr style="border:0;border-top:1px solid #E2E7F0;margin:0 0 24px 0;">
<h2 lang="id" style="margin:0 0 12px 0;font-size:22px;line-height:30px;font-weight:700;color:#0F1B3D;">Anda diundang ke ${e.org}</h2>
<p lang="id" style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:#0F1B3D;">Anda diundang untuk bergabung dengan ${e.org} sebagai ${e.role}.</p>
<p lang="id" style="margin:0 0 24px 0;font-size:14px;line-height:20px;color:#626E87;">Tautan hanya berlaku sekali dan kedaluwarsa dalam 7 hari. Jika Anda tidak mengharapkan ini, abaikan email ini.</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#626E87;word-break:break-all;">${e.url}</p>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:#626E87;text-align:center;">Restomate</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
  return { subject, html, text };
}
