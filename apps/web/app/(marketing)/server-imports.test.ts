import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** BUG-001: a server component must not call a function exported by a "use client" module. */
describe("marketing server components", () => {
  it("get buttonClasses from button-variants, not from the client button module", () => {
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(src).toContain('from "@/components/ui/button-variants"');
    expect(src).not.toMatch(/buttonClasses[^;]*from "@\/components\/ui\/button"/);
  });
});
