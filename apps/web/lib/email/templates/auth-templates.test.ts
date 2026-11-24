import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The Supabase Auth templates (pasted by hand on hosted projects) must keep the token_hash links. */
const DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "templates");
const TYPES: Record<string, string> = {
  "confirmation.html": "signup",
  "recovery.html": "recovery",
  "email_change.html": "email_change",
  "invite.html": "invite",
};

describe("supabase/templates", () => {
  it("has exactly the four templates", () => {
    expect(readdirSync(DIR).sort()).toEqual(Object.keys(TYPES).sort());
  });
  for (const [file, type] of Object.entries(TYPES)) {
    const html = readFileSync(join(DIR, file), "utf8");
    it(`${file} links with token_hash and type=${type}`, () => {
      expect(html).toContain(
        `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}`,
      );
    });
    it(`${file} never uses the PKCE link or a hard-coded host`, () => {
      expect(html).not.toContain("ConfirmationURL");
      expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    });
    it(`${file} is bilingual`, () => {
      expect(html).toContain('lang="en"');
      expect(html).toContain('lang="id"');
    });
  }
});
