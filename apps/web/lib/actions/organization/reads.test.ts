import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const U1 = "11111111-1111-4111-8111-111111111111";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = "66666666-6666-4666-8666-666666666666";
const LOC = "44444444-4444-4444-8444-444444444444";

type Row = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  member_id: string;
  member_status: string;
  role_id: string;
  role_key: string | null;
  role_name: string;
};
const membership = (over: Partial<Row> = {}): Row => ({
  org_id: ORG_A,
  org_slug: "warung",
  org_name: "Warung Sedap",
  org_status: "active",
  member_id: "m1",
  member_status: "active",
  role_id: ROLE,
  role_key: "owner",
  role_name: "Owner",
  ...over,
});

const world = {
  user: { id: U1, email: "owner@example.com" } as
    null | "unavailable" | { id: string; email: string | null },
  context: "ok" as "ok" | "no_membership" | "unavailable",
  memberships: [membership()] as Row[],
  profile: { data: { full_name: "Dewi" }, error: null } as { data: unknown; error: unknown },
  rpcError: null as unknown,
  locations: [{ id: LOC, name: "Kuta", timezone: "Asia/Makassar" }] as unknown[],
  locationsError: null as unknown,
  queries: [] as { table: string; eq: Record<string, unknown>; select: string; limit?: number }[],
  rpcs: [] as { fn: string; args: unknown }[],
};

vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => world.user,
}));
vi.mock("../../auth/org", async (original) => ({
  ...(await original<typeof import("../../auth/org")>()),
  getOrgContext: async () => {
    if (world.context !== "ok") return { ok: false, reason: world.context };
    return {
      ok: true,
      ctx: {
        user: { id: U1, email: "owner@example.com" },
        org: { id: ORG_A, slug: "warung", name: "Warung Sedap" },
        member: { id: "m1", roleId: ROLE, roleKey: "cashier", roleName: "Cashier" },
        permissions: new Set<string>(),
        package: null,
      },
    };
  },
}));
vi.mock("../../arcjet/organization", () => ({ protectOrg: async () => ({ allowed: true }) }));
vi.mock("../../supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => {
      world.rpcs.push({ fn, args });
      return world.rpcError
        ? { data: null, error: world.rpcError }
        : { data: world.memberships, error: null };
    },
    from: (table: string) => {
      const q = {
        table,
        eq: {} as Record<string, unknown>,
        select: "",
        limit: undefined as number | undefined,
      };
      const b = {
        select: (cols: string) => ((q.select = cols), b),
        eq: (c: string, v: unknown) => ((q.eq[c] = v), b),
        order: () => b,
        limit: (n: number) => ((q.limit = n), b),
        maybeSingle: async () => {
          world.queries.push(q);
          return world.profile;
        },
        then: (resolve: (v: unknown) => unknown) => {
          world.queries.push(q);
          return Promise.resolve(
            world.locationsError
              ? { data: null, error: world.locationsError }
              : { data: world.locations, error: null },
          ).then(resolve);
        },
      };
      return b;
    },
  }),
}));

import { listLocations, listMyOrganizations } from "./actions";

beforeEach(() => {
  Object.assign(world, {
    user: { id: U1, email: "owner@example.com" },
    context: "ok",
    memberships: [membership()],
    profile: { data: { full_name: "Dewi" }, error: null },
    rpcError: null,
    locations: [{ id: LOC, name: "Kuta", timezone: "Asia/Makassar" }],
    locationsError: null,
    queries: [],
    rpcs: [],
  });
});

describe("listMyOrganizations", () => {
  it("returns the user's memberships with explicit fields, and the display name", async () => {
    const r = await listMyOrganizations();
    expect(r).toEqual({
      ok: true,
      data: {
        user: { email: "owner@example.com", fullName: "Dewi" },
        organizations: [
          {
            orgId: ORG_A,
            slug: "warung",
            name: "Warung Sedap",
            orgStatus: "active",
            memberStatus: "active",
            roleId: ROLE,
            roleKey: "owner",
            roleName: "Owner",
          },
        ],
        atCap: false,
      },
    });
    expect(world.rpcs).toEqual([{ fn: "my_org_membership", args: {} }]); // all, not one org
    const profile = world.queries.find((q) => q.table === "profiles")!;
    expect(profile.eq).toEqual({ id: U1 }); // the caller's own row only
    expect(profile.select).toBe("full_name");
  });

  it("includes suspended orgs and deactivated memberships, so the page can show the notice", async () => {
    world.memberships = [
      membership(),
      membership({ org_id: ORG_B, org_status: "suspended", member_id: "m2" }),
      membership({
        org_id: "c",
        member_status: "deactivated",
        member_id: "m3",
        role_key: null,
        role_name: "Barista",
      }),
    ];
    const r = await listMyOrganizations();
    expect(
      r.ok && r.data.organizations.map((o) => [o.orgStatus, o.memberStatus, o.roleKey]),
    ).toEqual([
      ["active", "active", "owner"],
      ["suspended", "active", "owner"],
      ["active", "deactivated", null],
    ]);
  });

  it("no organizations is an empty list, and a missing name is null", async () => {
    world.memberships = [];
    world.profile = { data: null, error: null };
    expect(await listMyOrganizations()).toEqual({
      ok: true,
      data: {
        user: { email: "owner@example.com", fullName: null },
        organizations: [],
        atCap: false,
      },
    });
  });

  it("atCap counts only ACTIVE OWNER memberships: 3 owned is at the cap", async () => {
    const owned = (n: number, over: Partial<Row> = {}) =>
      membership({
        org_id: `0000000${n}-0000-4000-8000-000000000000`,
        member_id: `m${n}`,
        ...over,
      });
    world.memberships = [owned(1), owned(2)];
    expect((await listMyOrganizations()).ok && (await listMyOrganizations())).toMatchObject({
      data: { atCap: false },
    });

    world.memberships = [owned(1), owned(2), owned(3)];
    expect(await listMyOrganizations()).toMatchObject({ data: { atCap: true } });

    // A manager role, a deactivated owner and a custom role never count towards the cap.
    world.memberships = [
      owned(1),
      owned(2),
      owned(3, { role_key: "manager", role_name: "Manager" }),
      owned(4, { member_status: "deactivated" }),
      owned(5, { role_key: null, role_name: "Custom" }),
    ];
    expect(await listMyOrganizations()).toMatchObject({ data: { atCap: false } });
  });

  it("is unauthenticated when signed out and unavailable during an outage or a database failure", async () => {
    world.user = null;
    expect(await listMyOrganizations()).toEqual({ ok: false, error: { code: "unauthenticated" } });
    world.user = "unavailable";
    expect(await listMyOrganizations()).toEqual({ ok: false, error: { code: "unavailable" } });
    world.user = { id: U1, email: null };
    world.rpcError = { code: "", message: "fetch failed" };
    expect(await listMyOrganizations()).toEqual({ ok: false, error: { code: "unavailable" } });
    world.rpcError = null;
    world.profile = { data: null, error: { code: "XX000", message: "boom" } };
    expect(await listMyOrganizations()).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("an unknown status is an error, never shown as a known one", async () => {
    world.memberships = [membership({ org_status: "archived" })];
    expect(await listMyOrganizations()).toEqual({ ok: false, error: { code: "unavailable" } });
  });
});

describe("listLocations", () => {
  it("returns id, name and timezone of the verified org's locations, for any active member", async () => {
    expect(await listLocations({ orgId: ORG_A })).toEqual({
      ok: true,
      data: { locations: [{ id: LOC, name: "Kuta", timezone: "Asia/Makassar" }] },
    });
    const q = world.queries[0];
    expect(q.table).toBe("locations");
    expect(q.select).toBe("id, name, timezone");
    expect(q.eq).toEqual({ org_id: ORG_A });
    expect(q.limit).toBe(200);
  });

  it("reads the verified org even if the request names another one", async () => {
    await listLocations({ orgId: ORG_B });
    expect(world.queries[0].eq).toEqual({ org_id: ORG_A });
  });

  it("returns only the explicit columns even if a row carries more", async () => {
    world.locations = [
      { id: LOC, name: "Kuta", timezone: "Asia/Makassar", address: "x", tax_bps: 1100 },
    ];
    const r = await listLocations({ orgId: ORG_A });
    expect(r.ok && Object.keys(r.data.locations[0])).toEqual(["id", "name", "timezone"]);
  });

  it("passes on the context's refusal, validates the id, and an error is unavailable", async () => {
    world.context = "no_membership";
    expect(await listLocations({ orgId: ORG_A })).toEqual({
      ok: false,
      error: { code: "no_membership" },
    });
    world.context = "unavailable";
    expect(await listLocations({ orgId: ORG_A })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    world.context = "ok";
    expect(await listLocations({ orgId: "nope" })).toMatchObject({ error: { code: "validation" } });
    expect(await listLocations({})).toMatchObject({ error: { code: "validation" } });
    world.queries = [];
    world.locationsError = { message: "boom" };
    expect(await listLocations({ orgId: ORG_A })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });
});
