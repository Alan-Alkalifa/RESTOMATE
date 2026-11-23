import { describe, expect, it } from "vitest";
import {
  createRoleSchema,
  fieldErrorsOf,
  normalizeRoleName,
  readRoleInput,
  roleNameSchema,
  updateRoleSchema,
} from "./schemas";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("role names", () => {
  it.each([
    ["Owner⁠", "Owner"], // word joiner
    ["Owner  ", "Owner"], // trailing spaces
    ["  A   B  ", "A B"], // inner run collapsed
    ["A‍B‌C", "ABC"], // ZWJ, ZWNJ
    ["Cash­ier", "Cashier"], // soft hyphen
    ["A᠎B", "AB"], // Mongolian vowel separator
    ["﻿Bar", "Bar"], // byte order mark
    ["Ｂａｒ　Ｌｅａｄ", "Bar Lead"], // fullwidth letters and ideographic space (NFKC)
    ["Bar  Lead", "Bar Lead"], // no-break spaces
    ["Bar\t\nLead", "Bar Lead"], // tab and newline
    ["⁠Owner", "Owner"],
  ])("%j is saved as %j", (raw, clean) => {
    expect(normalizeRoleName(raw)).toBe(clean);
    expect(roleNameSchema.parse(raw)).toBe(clean);
  });

  it("'owner' + U+2060 and 'Owner  ' are the same name as 'Owner' once cleaned", () => {
    const names = ["owner⁠", "Owner  ", "OWNER", "Own­er"].map((n) => roleNameSchema.parse(n));
    expect(new Set(names.map((n) => n.toLowerCase()))).toEqual(new Set(["owner"]));
  });

  it("'A B' and 'A  B' are one name", () => {
    expect(roleNameSchema.parse("A  B")).toBe(roleNameSchema.parse("A B"));
  });

  it.each(["", "   ", "⁠‍", " \t"])("%j is required", (raw) => {
    const r = roleNameSchema.safeParse(raw);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("roles.name.required");
  });

  it("1 to 60 characters, counted as the database counts them", () => {
    expect(roleNameSchema.safeParse("n".repeat(60)).success).toBe(true);
    expect(roleNameSchema.safeParse("n".repeat(61)).error?.issues[0]?.message).toBe(
      "roles.name.too_long",
    );
    expect(roleNameSchema.safeParse("😀".repeat(60)).success).toBe(true); // 60 code points, 120 UTF-16 units
    expect(roleNameSchema.safeParse("😀".repeat(61)).success).toBe(false);
    // Cleaned first: invisible characters do not count toward the limit.
    expect(roleNameSchema.safeParse("n".repeat(60) + "⁠⁠").success).toBe(true);
  });

  it.each(["Bar\u0001Lead", "Bar\u007fLead", "Bar\ud800Lead"])(
    "%j has a character no name may hold",
    (raw) => {
      expect(roleNameSchema.safeParse(raw).error?.issues[0]?.message).toBe("roles.name.invalid");
    },
  );

  it("is not a string: required, and the value is never echoed", () => {
    for (const v of [undefined, null, 5, {}, []]) {
      const r = roleNameSchema.safeParse(v);
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues.map((i) => i.message))).toBe('["roles.name.required"]');
    }
  });
});

describe("create schema", () => {
  const base = {
    orgId: ORG,
    name: " Bar  Lead ",
    permissions: ["orders.view", "orders.view", "kitchen.view"],
  };

  it("cleans the name, de-duplicates permissions, blank description is none", () => {
    const r = createRoleSchema.parse({ ...base, description: "   " });
    expect(r).toEqual({
      orgId: ORG,
      name: "Bar Lead",
      description: undefined,
      permissions: ["orders.view", "kitchen.view"],
    });
  });

  it("permissions default to none", () => {
    expect(createRoleSchema.parse({ orgSlug: "warung", name: "X" }).permissions).toEqual([]);
  });

  it("an unknown permission key, or one that is not a string, is refused with a key", () => {
    for (const permissions of [["orders.view", "no.such"], [1], "orders.view"]) {
      const r = createRoleSchema.safeParse({ ...base, permissions });
      expect(r.success).toBe(false);
      expect(fieldErrorsOf(r.error!)).toEqual({ permissions: ["roles.permissions.invalid"] });
    }
  });

  it("needs exactly one of orgId and orgSlug", () => {
    expect(createRoleSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: "X", orgId: ORG, orgSlug: "w" }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: "X", orgId: "not-a-uuid" }).success).toBe(false);
  });

  it("a description over 300 characters is too long, 300 is fine", () => {
    expect(createRoleSchema.safeParse({ ...base, description: "d".repeat(300) }).success).toBe(
      true,
    );
    const r = createRoleSchema.safeParse({ ...base, description: "d".repeat(301) });
    expect(fieldErrorsOf(r.error!)).toEqual({ description: ["roles.description.too_long"] });
  });

  it("errors are keys only, never the typed value", () => {
    const r = createRoleSchema.safeParse({
      orgId: ORG,
      name: "x".repeat(61) + "SECRET",
      permissions: ["SECRET"],
    });
    expect(JSON.stringify(fieldErrorsOf(r.error!))).not.toContain("SECRET");
  });
});

describe("update schema", () => {
  it("an absent field stays absent (the database keeps it)", () => {
    const r = updateRoleSchema.parse({ orgId: ORG, roleId: ROLE });
    expect(r).toEqual({ orgId: ORG, roleId: ROLE });
    expect("name" in r || "description" in r || "permissions" in r).toBe(false);
  });

  it("an empty description is kept as '' (it clears), null is absent", () => {
    expect(updateRoleSchema.parse({ orgId: ORG, roleId: ROLE, description: "" }).description).toBe(
      "",
    );
    expect(
      updateRoleSchema.parse({ orgId: ORG, roleId: ROLE, description: "  " }).description,
    ).toBe("");
    expect(
      updateRoleSchema.parse({ orgId: ORG, roleId: ROLE, description: null }).description,
    ).toBeUndefined();
  });

  it("an empty permission list is a real list, not absent", () => {
    expect(
      updateRoleSchema.parse({ orgId: ORG, roleId: ROLE, permissions: [] }).permissions,
    ).toEqual([]);
  });

  it("a name that is sent is cleaned like on create", () => {
    expect(updateRoleSchema.parse({ orgId: ORG, roleId: ROLE, name: "owner⁠" }).name).toBe("owner");
  });

  it("needs a role id", () => {
    expect(updateRoleSchema.safeParse({ orgId: ORG, roleId: "x" }).success).toBe(false);
  });
});

describe("readRoleInput", () => {
  it("reads every permissions value of a form, and only the fields that were sent", () => {
    const fd = new FormData();
    fd.append("orgSlug", "warung");
    fd.append("name", "Bar");
    fd.append("permissions", "orders.view");
    fd.append("permissions", "kitchen.view");
    expect(readRoleInput(fd)).toEqual({
      orgSlug: "warung",
      name: "Bar",
      permissions: ["orders.view", "kitchen.view"],
    });
  });

  it("a form with no permission checked sends none: the list is absent, not empty", () => {
    const fd = new FormData();
    fd.append("name", "Bar");
    expect("permissions" in readRoleInput(fd)).toBe(false);
  });

  it("files and non-objects are ignored", () => {
    const fd = new FormData();
    fd.append("name", new File(["x"], "x.txt"));
    expect(readRoleInput(fd)).toEqual({});
    expect(readRoleInput(null)).toEqual({});
    expect(readRoleInput([1])).toEqual({});
    expect(readRoleInput("x")).toEqual({});
  });
});
