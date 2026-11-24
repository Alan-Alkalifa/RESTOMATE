import { describe, expect, it } from "vitest";
import { renderInvitationEmail } from "./invitation";

const link = "https://app.example.com/invite/accept?token=abc_DEF-123&x=1";

describe("renderInvitationEmail", () => {
  it("escapes every value in the html part", () => {
    const r = renderInvitationEmail({
      orgName: `<img src=x onerror="alert(1)"> & Co`,
      roleName: `"><script>x()</script>`,
      acceptUrl: link,
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img");
    expect(r.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co");
    expect(r.html).toContain("token=abc_DEF-123&amp;x=1");
  });

  it("keeps the subject on one line", () => {
    const r = renderInvitationEmail({
      orgName: "Warung\r\nBcc: x@y.z\u2028Sedap",
      roleName: "Cashier",
      acceptUrl: link,
    });
    expect(r.subject).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(r.subject).toContain("Warung Bcc: x@y.z Sedap");
  });

  it("is bilingual, with the link in both the html and the text", () => {
    const r = renderInvitationEmail({
      orgName: "Warung Sedap",
      roleName: "Cashier",
      acceptUrl: link,
    });
    expect(r.subject).toBe(
      "You're invited to Warung Sedap on Restomate / Anda diundang ke Warung Sedap di Restomate",
    );
    for (const part of [r.html, r.text]) {
      expect(part).toContain("Anda diundang untuk bergabung dengan Warung Sedap sebagai Cashier");
    }
    expect(r.text).toContain(`Accept: ${link}`);
    expect(r.text).not.toContain("&amp;");
  });

  it("refuses a link that is not http(s)", () => {
    expect(() =>
      renderInvitationEmail({ orgName: "A", roleName: "B", acceptUrl: "javascript:alert(1)" }),
    ).toThrow();
  });
});
