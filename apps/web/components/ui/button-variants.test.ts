import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buttonClasses } from "./button-variants";

describe("button-variants", () => {
  it("has no 'use client' (server components import it)", () => {
    const src = readFileSync(join(__dirname, "button-variants.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/);
  });
  it("styles a link like the button", () => {
    const cls = buttonClasses({ variant: "spotlight", size: "lg", className: "self-start" });
    expect(cls).toContain("bg-accent");
    expect(cls).toContain("h-control-lg");
    expect(cls).toContain("self-start");
  });

  // BUG-001: these are server components. A function imported from the "use client" button module
  // throws when a server component calls it, so they must import the classes from here.
  it.each(["app/(marketing)/page.tsx", "app/(admin)/app/page.tsx"])(
    "%s is a server component that imports buttonClasses from button-variants",
    (file) => {
      const src = readFileSync(join(__dirname, "..", "..", file), "utf8");
      expect(src).not.toMatch(/^\s*["']use client["']/);
      expect(src).toContain('from "@/components/ui/button-variants"');
      expect(src).not.toMatch(/buttonClasses[^;]*from "@\/components\/ui\/button"/);
    },
  );
});
