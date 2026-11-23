import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const U4 = "44444444-4444-4444-8444-444444444444";
const R_OWNER = "66666666-6666-4666-8666-666666666661";
const R_CASH = "66666666-6666-4666-8666-666666666662";
const LOC1 = "77777777-7777-4777-8777-777777777771";
const LOC2 = "77777777-7777-4777-8777-777777777772";

type Q = {
  table: string;
  client: "user" | "admin";
  select: string;
  eq: Record<string, unknown>;
  limit?: number;
};
const world = {
  permissions: ["staff.manage"] as string[],
  context: "ok" as "ok" | "no_membership" | "unavailable",
  members: [] as Record<string, unknown>[],
  roles: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
  fail: null as null | "members" | "roles" | "links" | "profiles",
  queries: [] as Q[],
};

function builder(client: "user" | "admin", table: string) {
  const q: Q = { table, client, select: "", eq: {} };
  const b = {
    select: (cols: string) => ((q.select = cols), b),
    eq: (c: string, v: unknown) => ((q.eq[c] = v), b),
    in: () => b,
    order: () => b,
    limit: (n: number) => ((q.limit = n), b),
    then: (resolve: (v: unknown) => unknown) => {
      world.queries.push(q);
      const key = {
        organization_members: "members",
        roles: "roles",
        location_staff: "links",
        profiles: "profiles",
      }[table]!;
      const data = {
        members: world.members,
        roles: world.roles,
        links: world.links,
        profiles: world.profiles,
      }[key];
      return Promise.resolve(
        world.fail === key ? { data: null, error: { message: "boom" } } : { data, error: null },
      ).then(resolve);
    },
  };
  return b;
}

vi.mock("../../auth/org", async (original) => ({
  ...(await original<typeof import("../../auth/org")>()),
  getOrgContext: async () => {
    if (world.context !== "ok") return { ok: false, reason: world.context };
    return {
      ok: true,
      ctx: {
        user: { id: ME, email: "me@example.com" },
        org: { id: ORG, slug: "warung", name: "Warung" },
        member: { id: "m0", roleId: R_OWNER, roleKey: "owner", roleName: "Owner" },
        permissions: new Set(world.permissions),
        package: null,
      },
    };
  },
}));
vi.mock("../../supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => builder("admin", t) }),
}));
vi.mock("../../supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder("user", t) }),
}));

import { listMembers } from "./actions";

const member = (id: string, userId: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: userId,
  role_id: R_CASH,
  status: "active",
  deactivated_at: null,
  ...over,
});

beforeEach(() => {
  Object.assign(world, {
    permissions: ["staff.manage"],
    context: "ok",
    members: [
      member("m-me", ME, { role_id: R_OWNER }),
      member("m-zed", U2),
      member("m-amy", U3),
      member("m-old", U4, { status: "deactivated", deactivated_at: "2026-11-01T00:00:00Z" }),
    ],
    roles: [
      { id: R_OWNER, name: "Owner", system_key: "owner" },
      { id: R_CASH, name: "Cashier", system_key: "cashier" },
    ],
    links: [
      { member_id: "m-zed", location_id: LOC1 },
      { member_id: "m-zed", location_id: LOC2 },
    ],
    profiles: [
      { id: ME, email: "me@example.com", full_name: "Budi" },
      { id: U2, email: "zed@example.com", full_name: "Zed" },
      { id: U3, email: "amy@example.com", full_name: "amy" },
      { id: U4, email: "old@example.com", full_name: null },
    ],
    fail: null,
    queries: [],
  });
});

describe("listMembers", () => {
  it("a Cashier gets forbidden and nothing is read", async () => {
    world.permissions = ["orders.view", "pos.use"];
    expect(await listMembers({ orgId: ORG })).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(world.queries).toEqual([]);
  });

  it("passes on the context's refusals and validates the input", async () => {
    world.context = "no_membership";
    expect(await listMembers({ orgId: ORG })).toEqual({
      ok: false,
      error: { code: "no_membership" },
    });
    world.context = "ok";
    for (const bad of [{ orgId: "x" }, { orgId: ORG, limit: 0 }, { orgId: ORG, limit: 201 }]) {
      expect(await listMembers(bad)).toMatchObject({ error: { code: "validation" } });
    }
    expect(world.queries).toEqual([]);
  });

  it("returns the explicit fields, with the caller's own row marked isSelf", async () => {
    const r = await listMembers({ orgId: ORG });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const me = r.data.members.find((m) => m.userId === ME)!;
    expect(me).toEqual({
      memberId: "m-me",
      userId: ME,
      isSelf: true,
      fullName: "Budi",
      email: "me@example.com",
      roleId: R_OWNER,
      roleName: "Owner",
      roleKey: "owner",
      status: "active",
      deactivatedAt: null,
      locationIds: [],
    });
    expect(r.data.members.filter((m) => m.isSelf)).toHaveLength(1);
    const zed = r.data.members.find((m) => m.userId === U2)!;
    expect(zed.locationIds).toEqual([LOC1, LOC2]);
    expect(zed).toMatchObject({ isSelf: false, roleKey: "cashier", roleName: "Cashier" });
  });

  it("sorts active first, then deactivated, each A to Z by name (the address without a name)", async () => {
    const r = await listMembers({ orgId: ORG });
    // amy, Budi, Zed (A to Z, ignoring case), then the deactivated one
    expect(r.ok && r.data.members.map((m) => m.memberId)).toEqual([
      "m-amy",
      "m-me",
      "m-zed",
      "m-old",
    ]);
  });

  it("the deactivated member has its date and no name falls back to null", async () => {
    const r = await listMembers({ orgId: ORG });
    const old = r.ok && r.data.members.find((m) => m.memberId === "m-old");
    expect(old).toMatchObject({
      status: "deactivated",
      deactivatedAt: "2026-11-01T00:00:00Z",
      fullName: null,
      email: "old@example.com",
    });
  });

  it("reads members, roles and links as the user, and profiles as admin: pinned, explicit columns, no secrets", async () => {
    await listMembers({ orgId: OTHER_ORG }); // the request names another org
    const by = (t: string) => world.queries.find((q) => q.table === t)!;
    expect(by("organization_members")).toMatchObject({
      client: "user",
      select: "id, user_id, role_id, status, deactivated_at",
      eq: { org_id: ORG },
    });
    expect(by("roles")).toMatchObject({ client: "user", eq: { org_id: ORG } });
    expect(by("location_staff")).toMatchObject({ client: "user", eq: { org_id: ORG } });
    expect(by("profiles")).toMatchObject({ client: "admin", select: "id, email, full_name" });
    for (const q of world.queries) expect(q.select).not.toMatch(/\*|token|password/i);
    expect(world.queries.every((q) => q.eq.org_id === undefined || q.eq.org_id === ORG)).toBe(true);
  });

  it("applies the limit (100 by default) and an org with no members is an empty list", async () => {
    await listMembers({ orgId: ORG });
    expect(world.queries.find((q) => q.table === "organization_members")!.limit).toBe(100);
    world.queries = [];
    await listMembers({ orgId: ORG, limit: "25" });
    expect(world.queries.find((q) => q.table === "organization_members")!.limit).toBe(25);
    world.members = [];
    expect(await listMembers({ orgId: ORG })).toEqual({ ok: true, data: { members: [] } });
  });

  it.each(["members", "roles", "links", "profiles"] as const)(
    "a failed read (%s) is unavailable, never a partial list",
    async (which) => {
      world.fail = which;
      expect(await listMembers({ orgId: ORG })).toEqual({
        ok: false,
        error: { code: "unavailable" },
      });
    },
  );
});
