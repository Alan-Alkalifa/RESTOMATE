import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const U1 = "11111111-1111-4111-8111-111111111111";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

import { PERMISSION_KEYS } from "../../auth/keys";
import type { OrgContext } from "../../auth/org";

const ownerCtx = (over: Partial<OrgContext> = {}): OrgContext => ({
  user: { id: U1, email: "owner@example.com" } as OrgContext["user"],
  org: { id: ORG, slug: "warung", name: "Warung" },
  member: { id: "m1", roleId: "r1", roleKey: "owner", roleName: "Owner" },
  permissions: new Set<string>(PERMISSION_KEYS),
  package: { features: { custom_roles: true } } as unknown as OrgContext["package"],
  ...over,
});

type OrgResult = { ok: true; ctx: OrgContext } | { ok: false; reason: string };
const world = {
  order: [] as string[],
  org: { ok: true, ctx: ownerCtx() } as OrgResult,
  refs: [] as unknown[],
  refreshed: [] as [string, string][],
  rpc: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
};

vi.mock("../../auth/org", async (original) => ({
  ...(await original<typeof import("../../auth/org")>()),
  getOrgContext: async (ref: unknown) => {
    world.order.push("context");
    world.refs.push(ref);
    return world.org;
  },
  refreshMemberAccess: (orgId: string, userId: string) => world.refreshed.push([orgId, userId]),
}));
vi.mock("../../supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      world.order.push(`rpc:${fn}`);
      world.calls.push({ fn, args });
      const handler = world.rpc[fn];
      return handler ? handler(args) : { data: null, error: null };
    },
  }),
}));

import { createRole, deleteRole, updateRole } from "./actions";

const dbError = (message: string, code = "P0001") => ({ data: null, error: { code, message } });
const member = (
  permissions: string[],
  features: Record<string, boolean> = { custom_roles: true },
) =>
  ({
    ok: true,
    ctx: ownerCtx({
      permissions: new Set(permissions),
      package: { features } as unknown as OrgContext["package"],
    }),
  }) satisfies OrgResult;

beforeEach(() => {
  Object.assign(world, {
    order: [],
    org: { ok: true, ctx: ownerCtx() },
    refs: [],
    refreshed: [],
    rpc: {},
    calls: [],
  });
});

describe("createRole", () => {
  it("cleans the input, checks the caller, then calls the RPC as the caller", async () => {
    world.rpc.create_role = () => ({ data: ROLE, error: null });
    const r = await createRole({
      orgSlug: "warung",
      name: "  Bar⁠  Lead ",
      description: " Runs the bar ",
      permissions: ["orders.view", "kitchen.view", "orders.view"],
    });
    expect(r).toEqual({ ok: true, data: { roleId: ROLE } });
    expect(world.refs).toEqual([{ slug: "warung" }]);
    expect(world.calls).toEqual([
      {
        fn: "create_role",
        args: {
          p_org_id: ORG,
          p_name: "Bar Lead",
          p_description: "Runs the bar",
          p_permission_keys: ["orders.view", "kitchen.view"],
        },
      },
    ]);
    expect(world.order).toEqual(["context", "rpc:create_role"]);
    expect(world.refreshed).toEqual([[ORG, U1]]);
  });

  it("looks the org up by ID when it is sent by ID, and sends the org the context found", async () => {
    world.rpc.create_role = () => ({ data: ROLE, error: null });
    await createRole({ orgId: ORG, name: "X" });
    expect(world.refs).toEqual([{ orgId: ORG }]);
    expect(world.calls[0]?.args).toMatchObject({
      p_org_id: ORG,
      p_description: null,
      p_permission_keys: [],
    });
  });

  it("reads a FormData with one checkbox per permission", async () => {
    world.rpc.create_role = () => ({ data: ROLE, error: null });
    const fd = new FormData();
    fd.append("orgSlug", "warung");
    fd.append("name", "Bar");
    fd.append("permissions", "orders.view");
    fd.append("permissions", "kitchen.view");
    expect((await createRole(fd)).ok).toBe(true);
    expect(world.calls[0]?.args.p_permission_keys).toEqual(["orders.view", "kitchen.view"]);
  });

  it("'owner' + U+2060 and 'Owner  ' reach the database as 'owner' and 'Owner', and are refused as duplicates of 'Owner'", async () => {
    // The database's rule: one role name per org, ignoring case (a unique index on lower(name)).
    const existing = new Set(["owner", "manager", "cashier", "waiter", "kitchen"]);
    world.rpc.create_role = (args) =>
      existing.has(String(args.p_name).toLowerCase())
        ? dbError("ROLE_NAME_TAKEN")
        : { data: ROLE, error: null };
    for (const typed of ["owner⁠", "Owner  ", "OWNER", "own­er", "Ｏｗｎｅｒ", "‍Owner"]) {
      expect(await createRole({ orgId: ORG, name: typed })).toEqual({
        ok: false,
        error: { code: "conflict", fieldErrors: { name: ["roles.name.taken"] } },
      });
    }
    expect(world.calls.map((c) => c.args.p_name).slice(0, 2)).toEqual(["owner", "Owner"]);
    expect(world.refreshed).toEqual([]);
    // A genuinely different name still works.
    expect((await createRole({ orgId: ORG, name: "Owner Assistant" })).ok).toBe(true);
  });

  it("a name that is empty once cleaned never reaches the database", async () => {
    expect(await createRole({ orgId: ORG, name: "⁠ ‍" })).toEqual({
      ok: false,
      error: { code: "validation", fieldErrors: { name: ["roles.name.required"] } },
    });
    expect(world.order).toEqual([]);
  });

  it("needs staff.manage: a Cashier is forbidden before the database is asked", async () => {
    world.org = member(["pos.use", "orders.view"]);
    expect(await createRole({ orgId: ORG, name: "X" })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.calls).toEqual([]);
  });

  it("needs the custom_roles feature", async () => {
    world.org = member([...PERMISSION_KEYS], { custom_roles: false });
    expect(await createRole({ orgId: ORG, name: "X" })).toEqual({
      ok: false,
      error: { code: "feature_unavailable", fieldErrors: { form: ["roles.feature_unavailable"] } },
    });
    world.org = { ok: true, ctx: ownerCtx({ package: null }) };
    expect((await createRole({ orgId: ORG, name: "X" })).ok).toBe(false);
    expect(world.calls).toEqual([]);
  });

  it("nobody grants a permission they lack: refused here, before the database", async () => {
    world.org = member(["staff.manage", "orders.view"]);
    expect(
      await createRole({ orgId: ORG, name: "X", permissions: ["orders.view", "reports.view"] }),
    ).toEqual({
      ok: false,
      error: { code: "forbidden", fieldErrors: { permissions: ["roles.permissions.not_held"] } },
    });
    expect(world.calls).toEqual([]);
    world.rpc.create_role = () => ({ data: ROLE, error: null });
    expect((await createRole({ orgId: ORG, name: "X", permissions: ["orders.view"] })).ok).toBe(
      true,
    );
  });

  it("and the database has the last word when the cached permissions were stale", async () => {
    world.rpc.create_role = () => dbError("ESCALATION_DENIED", "42501");
    expect(await createRole({ orgId: ORG, name: "X", permissions: ["orders.view"] })).toEqual({
      ok: false,
      error: { code: "forbidden", fieldErrors: { permissions: ["roles.permissions.not_held"] } },
    });
  });

  it.each([
    ["unauthenticated"],
    ["no_membership"],
    ["org_suspended"],
    ["member_deactivated"],
    ["unavailable"],
  ])("an access refusal (%s) is passed on as its code, with no database call", async (reason) => {
    world.org = { ok: false, reason };
    expect(await createRole({ orgId: ORG, name: "X" })).toEqual({
      ok: false,
      error: { code: reason },
    });
    expect(world.calls).toEqual([]);
  });

  it("bad input is a validation result and asks nobody", async () => {
    expect(await createRole({ orgId: ORG, name: "X", permissions: ["no.such"] })).toEqual({
      ok: false,
      error: { code: "validation", fieldErrors: { permissions: ["roles.permissions.invalid"] } },
    });
    expect(await createRole(null)).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(world.order).toEqual([]);
  });

  it("a 301-character description is a description error, not a name error", async () => {
    expect(await createRole({ orgId: ORG, name: "X", description: "d".repeat(301) })).toEqual({
      ok: false,
      error: { code: "validation", fieldErrors: { description: ["roles.description.too_long"] } },
    });
  });

  it("an RPC that returns nothing is unknown, and nothing is refreshed", async () => {
    world.rpc.create_role = () => ({ data: null, error: null });
    expect(await createRole({ orgId: ORG, name: "X" })).toEqual({
      ok: false,
      error: { code: "unknown" },
    });
    expect(world.refreshed).toEqual([]);
  });
});

describe("updateRole", () => {
  it("sends null for every field that was not sent (the database keeps them)", async () => {
    await updateRole({ orgId: ORG, roleId: ROLE });
    expect(world.calls).toEqual([
      {
        fn: "update_role",
        args: { p_role_id: ROLE, p_name: null, p_description: null, p_permission_keys: null },
      },
    ]);
  });

  it("'' clears the description, [] removes every permission, a new name is cleaned", async () => {
    expect(
      await updateRole({
        orgId: ORG,
        roleId: ROLE,
        name: "Bar  Boss⁠",
        description: "",
        permissions: [],
      }),
    ).toEqual({
      ok: true,
      data: undefined,
    });
    expect(world.calls[0]?.args).toEqual({
      p_role_id: ROLE,
      p_name: "Bar Boss",
      p_description: "",
      p_permission_keys: [],
    });
    expect(world.refreshed).toEqual([[ORG, U1]]);
  });

  it("a duplicate name is a field error", async () => {
    world.rpc.update_role = () => dbError("ROLE_NAME_TAKEN");
    expect(await updateRole({ orgId: ORG, roleId: ROLE, name: "owner⁠" })).toEqual({
      ok: false,
      error: { code: "conflict", fieldErrors: { name: ["roles.name.taken"] } },
    });
    expect(world.calls[0]?.args.p_name).toBe("owner");
  });

  it("nobody grants a permission they lack, and a role that holds one they lack is the database's refusal", async () => {
    world.org = member(["staff.manage", "orders.view"]);
    expect(await updateRole({ orgId: ORG, roleId: ROLE, permissions: ["reports.view"] })).toEqual({
      ok: false,
      error: { code: "forbidden", fieldErrors: { permissions: ["roles.permissions.not_held"] } },
    });
    expect(world.calls).toEqual([]);
    world.rpc.update_role = () => dbError("ESCALATION_DENIED", "42501");
    expect(await updateRole({ orgId: ORG, roleId: ROLE, name: "Renamed" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("needs staff.manage and the feature", async () => {
    world.org = member(["orders.view"]);
    expect(await updateRole({ orgId: ORG, roleId: ROLE, name: "X" })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    world.org = member(["staff.manage"], { custom_roles: false });
    expect(await updateRole({ orgId: ORG, roleId: ROLE, name: "X" })).toMatchObject({
      ok: false,
      error: { code: "feature_unavailable" },
    });
    expect(world.calls).toEqual([]);
  });

  it("a system role is refused with a form error", async () => {
    world.rpc.update_role = () => dbError("ROLE_SYSTEM");
    expect(await updateRole({ orgId: ORG, roleId: ROLE, name: "X" })).toEqual({
      ok: false,
      error: { code: "forbidden", fieldErrors: { form: ["roles.system_role"] } },
    });
  });

  it("a role of another org looks like any other forbidden", async () => {
    world.rpc.update_role = () => dbError("FORBIDDEN", "42501");
    expect(await updateRole({ orgId: ORG, roleId: ROLE, name: "X" })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});

describe("deleteRole", () => {
  it("deletes through the RPC as the caller", async () => {
    expect(await deleteRole({ orgSlug: "warung", roleId: ROLE })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(world.calls).toEqual([{ fn: "delete_role", args: { p_role_id: ROLE } }]);
    expect(world.refreshed).toEqual([[ORG, U1]]);
  });

  it("needs no package feature: a downgraded org can still clean up", async () => {
    world.org = member(["staff.manage"], { custom_roles: false });
    expect((await deleteRole({ orgId: ORG, roleId: ROLE })).ok).toBe(true);
    world.org = { ok: true, ctx: ownerCtx({ package: null }) };
    expect((await deleteRole({ orgId: ORG, roleId: ROLE })).ok).toBe(true);
  });

  it("needs staff.manage", async () => {
    world.org = member(["pos.use"]);
    expect(await deleteRole({ orgId: ORG, roleId: ROLE })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.calls).toEqual([]);
  });

  it("a role in use is a conflict; a system role is forbidden; a role holding permissions the caller lacks is forbidden", async () => {
    world.rpc.delete_role = () => dbError("ROLE_IN_USE");
    expect(await deleteRole({ orgId: ORG, roleId: ROLE })).toEqual({
      ok: false,
      error: { code: "conflict", fieldErrors: { form: ["roles.in_use"] } },
    });
    world.rpc.delete_role = () => dbError("ROLE_SYSTEM");
    expect(await deleteRole({ orgId: ORG, roleId: ROLE })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    world.rpc.delete_role = () => dbError("ESCALATION_DENIED", "42501");
    expect(await deleteRole({ orgId: ORG, roleId: ROLE })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.refreshed).toEqual([]);
  });

  it("a role id that is not a UUID asks nobody", async () => {
    expect(await deleteRole({ orgId: ORG, roleId: "nope" })).toEqual({
      ok: false,
      error: { code: "validation", fieldErrors: { roleId: ["roles.role.invalid"] } },
    });
    expect(world.order).toEqual([]);
  });
});

describe("database errors", () => {
  const cases: [string, string | undefined, string, Record<string, string[]> | undefined][] = [
    ["UNAUTHENTICATED", "28000", "unauthenticated", undefined],
    ["FORBIDDEN", "42501", "forbidden", undefined],
    ["NAME_INVALID", "P0001", "validation", { name: ["roles.name.invalid"] }],
    ["DESCRIPTION_INVALID", "P0001", "validation", { description: ["roles.description.too_long"] }],
    ["PERMISSION_INVALID", "P0001", "validation", { permissions: ["roles.permissions.invalid"] }],
    [
      "PLAN_FEATURE:custom_roles",
      "P0001",
      "feature_unavailable",
      { form: ["roles.feature_unavailable"] },
    ],
    ["SOMETHING NEW", "P0001", "unknown", undefined],
    ["canceling statement due to statement timeout", "57014", "unavailable", undefined],
  ];
  it.each(cases)("%s (%s) is %s", async (message, code, expected, fieldErrors) => {
    world.rpc.create_role = () => dbError(message, code);
    expect(await createRole({ orgId: ORG, name: "X" })).toEqual({
      ok: false,
      error: fieldErrors ? { code: expected, fieldErrors } : { code: expected },
    });
  });

  it("no SQLSTATE at all (the request got no answer) is unavailable, and no text leaks", async () => {
    world.rpc.create_role = () => ({ data: null, error: { message: "fetch failed: secret-host" } });
    const r = await createRole({ orgId: ORG, name: "X" });
    expect(r).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(JSON.stringify(r)).not.toContain("secret-host");
  });
});
