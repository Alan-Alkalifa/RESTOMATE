import { describe, expect, it } from "vitest";
import { messages } from "@/messages";
import { ADMIN_NAV, visibleNav } from "./nav";

const hrefs = (perms: string[]) =>
  visibleNav("demo", (p) => perms.includes(p)).flatMap((s) => s.entries.map((e) => e.href));

describe("visibleNav", () => {
  it("shows a member without permissions only the dashboard", () => {
    expect(hrefs([])).toEqual(["/app/demo"]);
  });
  it("adds the team pages for staff.manage", () => {
    expect(hrefs(["staff.manage"])).toEqual(["/app/demo", "/app/demo/staff", "/app/demo/roles"]);
  });
  it("ignores permissions the nav does not use", () => {
    expect(hrefs(["pos.use", "orders.view"])).toEqual(["/app/demo"]);
  });
  it("drops sections that end up empty", () => {
    expect(visibleNav("demo", () => false).map((s) => s.id)).toEqual(["main"]);
  });
  it("encodes the slug in links", () => {
    expect(visibleNav("a/b", () => false)[0].entries[0].href).toBe("/app/a%2Fb");
  });
  it("has a label in both languages for every entry", () => {
    const keys = ADMIN_NAV.flatMap((s) => [s.titleKey, ...s.entries.map((e) => e.labelKey)]);
    for (const k of keys.filter(Boolean) as string[]) {
      expect(messages.en).toHaveProperty([k]);
      expect(messages.id).toHaveProperty([k]);
    }
  });
});
