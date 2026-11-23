import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sent: Record<string, unknown>[] = [];
vi.mock("../../email", () => ({
  sendEmail: async (m: Record<string, unknown>) => {
    sent.push(m);
    return { ok: true, delivery: "log" };
  },
}));

import {
  acceptInvitationUrl,
  invitationEmailKey,
  renderInvitationEmail,
  sendInvitationEmail,
} from "./email";

const INV = "44444444-4444-4444-8444-444444444444";
const TOKEN = "A".repeat(43);

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.restomate.app");
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate.app");
});
afterEach(() => vi.unstubAllEnvs());

describe("invitation email", () => {
  it("links to the app's own URL with the token", () => {
    expect(acceptInvitationUrl(TOKEN)).toBe(
      `https://app.restomate.app/invite/accept?token=${TOKEN}`,
    );
  });

  it("sends one email to one address with a key per invitation and the token in the body only", async () => {
    await sendInvitationEmail({
      invitationId: INV,
      to: "siti@example.com",
      token: TOKEN,
      orgName: "Warung",
      roleName: "Cashier",
    });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m).toMatchObject({
      kind: "staff_invitation",
      referenceId: INV,
      to: "siti@example.com",
      idempotencyKey: invitationEmailKey(INV),
    });
    expect(String(m.text)).toContain(TOKEN);
    expect(String(m.idempotencyKey)).not.toContain(TOKEN);
    expect(String(m.subject)).not.toContain(TOKEN);
  });

  it("gives each invitation its own key", () => {
    expect(invitationEmailKey(INV)).not.toBe(
      invitationEmailKey("55555555-5555-4555-8555-555555555555"),
    );
  });

  it("escapes names in the HTML and keeps the subject on one line", () => {
    const r = renderInvitationEmail({
      orgName: 'Warung <b>"A"</b>\r\nBcc: x',
      roleName: "Cashier",
      acceptUrl: "https://app.restomate.app/x",
    });
    expect(r.html).not.toContain("<b>");
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});
