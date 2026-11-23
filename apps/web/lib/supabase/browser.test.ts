import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./browser.ts", import.meta.url), "utf8");

describe("browser client", () => {
  it("does not import lib/env, which would carry server secret names into the client bundle", () => {
    expect(source).not.toMatch(/from\s+["'][^"']*env["']/);
  });

  it("names no server secret", () => {
    for (const name of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "RESEND_API_KEY",
      "ARCJET_KEY",
      "DOKU_SECRET_KEY",
      "APP_ENCRYPTION_KEY",
    ]) {
      expect(source).not.toContain(name);
    }
  });

  it("reads only literal NEXT_PUBLIC_SUPABASE_* variables (the only form Next inlines)", () => {
    const reads = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const name of reads) expect(name).toMatch(/^NEXT_PUBLIC_SUPABASE_/);
    expect(source).not.toMatch(/process\.env\[/);
  });
});
