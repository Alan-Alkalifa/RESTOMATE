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
});
