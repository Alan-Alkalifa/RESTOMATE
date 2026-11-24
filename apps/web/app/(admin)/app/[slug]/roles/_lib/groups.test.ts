import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@/lib/auth/keys";
import { messages } from "@/messages";
import { PERMISSION_GROUPS, holdsAll, permissionLabelKey } from "./groups";

describe("permission groups", () => {
  it("cover every permission key exactly once", () => {
    const all = PERMISSION_GROUPS.flatMap((g) => g.keys);
    expect([...all].sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(new Set(all).size).toBe(all.length);
  });
  it("have a label in both languages for every group and key", () => {
    for (const g of PERMISSION_GROUPS) {
      expect(messages.en).toHaveProperty([g.labelKey]);
      expect(messages.id).toHaveProperty([g.labelKey]);
      for (const k of g.keys) {
        expect(messages.en).toHaveProperty([permissionLabelKey(k)]);
        expect(messages.id).toHaveProperty([permissionLabelKey(k)]);
      }
    }
  });
});

describe("holdsAll", () => {
  it("needs every permission of the role", () => {
    const role = { permissions: ["menu.manage", "pos.use"] };
    expect(holdsAll(new Set(["menu.manage", "pos.use", "x"]), role)).toBe(true);
    expect(holdsAll(new Set(["menu.manage"]), role)).toBe(false);
    expect(holdsAll(new Set(), { permissions: [] })).toBe(true);
  });
});
