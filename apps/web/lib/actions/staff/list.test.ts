import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = "66666666-6666-4666-8666-666666666666";
const LOC1 = "44444444-4444-4444-8444-444444444444";
const LOC2 = "55555555-5555-4555-8555-555555555555";
const day = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

type Row = {
  id: string;
  email: string;
  role_id: string | null;
  all_locations: boolean;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  email: `${id}@example.com`,
  role_id: ROLE,
  all_locations: false,
  created_at: iso(-day),
  expires_at: iso(6 * day),
  accepted_at: null,
  revoked_at: null,
  ...over,
});

const world = {
  permissions: ["staff.manage"] as string[],
  context: "ok" as "ok" | "no_membership" | "unavailable",
  unclosed: [] as Row[],
  closed: [] as Row[],
  locations: [] as { invitation_id: string; location_id: string }[],
  roles: [{ id: ROLE, name: "Cashier" }] as { id: string; name: string }[],
  fail: null as null | "unclosed" | "closed" | "locations" | "roles",
  queries: [] as { table: string; select: string; eq: Record<string, unknown>; limit?: number }[],
};

/** A thenable query builder: records what was asked and answers from `world`. */
function builder(
  table: string,
  answer: (q: (typeof world.queries)[number], or: boolean) => unknown,
) {
  const q = {
    table,
    select: "",
    eq: {} as Record<string, unknown>,
    limit: undefined as number | undefined,
  };
  let or = false;
  const b = {
    select: (cols: string) => ((q.select = cols), b),
    eq: (c: string, v: unknown) => ((q.eq[c] = v), b),
    is: () => b,
    in: () => b,
    or: () => ((or = true), b),
    order: () => b,
    limit: (n: number) => ((q.limit = n), b),
    then: (resolve: (v: unknown) => unknown) => {
      world.queries.push(q);
      return Promise.resolve(answer(q, or)).then(resolve);
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
        user: { id: "u", email: null },
        org: { id: ORG, slug: "warung", name: "Warung" },
        member: { id: "m0", roleId: "r0", roleKey: "manager", roleName: "Manager" },
        permissions: new Set(world.permissions),
        package: null,
      },
    };
  },
}));
vi.mock("../../supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      builder(table, (_q, or) => {
        if (table === "staff_invitations") {
          const kind = or ? "closed" : "unclosed";
          if (world.fail === kind) return { data: null, error: { message: "boom" } };
          return { data: or ? world.closed : world.unclosed, error: null };
        }
        if (world.fail === "locations") return { data: null, error: { message: "boom" } };
        return { data: world.locations, error: null };
      }),
  }),
}));
vi.mock("../../supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      builder(table, () =>
        world.fail === "roles"
          ? { data: null, error: { message: "boom" } }
          : { data: world.roles, error: null },
      ),
  }),
}));

import { listInvitations } from "./actions";

beforeEach(() => {
  Object.assign(world, {
    permissions: ["staff.manage"],
    context: "ok",
    unclosed: [],
    closed: [],
    locations: [],
    roles: [{ id: ROLE, name: "Cashier" }],
    fail: null,
    queries: [],
  });
});

describe("listInvitations", () => {
  it("a Cashier gets forbidden and nothing is read", async () => {
    world.permissions = ["orders.view", "pos.use"];
    expect(await listInvitations({ orgId: ORG })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.queries).toEqual([]);
  });

  it("passes on the context's refusals", async () => {
    world.context = "no_membership";
    expect(await listInvitations({ orgId: ORG })).toEqual({
      ok: false,
      error: { code: "no_membership" },
    });
    world.context = "unavailable";
    expect(await listInvitations({ orgId: ORG })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(world.queries).toEqual([]);
  });

  it("never selects or returns token_hash, and pins every read to the verified org", async () => {
    world.unclosed = [row("open1")];
    const r = await listInvitations({ orgId: ORG });
    expect(r.ok).toBe(true);
    for (const q of world.queries) {
      expect(q.select).not.toMatch(/token|\*/);
    }
    for (const q of world.queries.filter((q) => q.table !== "roles")) {
      expect(q.eq.org_id).toBe(ORG);
    }
    expect(world.queries.find((q) => q.table === "roles")?.eq.org_id).toBe(ORG);
    if (r.ok) {
      expect(JSON.stringify(r.data)).not.toMatch(/token/i);
      expect(Object.keys(r.data.invitations[0]).sort()).toEqual(
        [
          "acceptedAt",
          "allLocations",
          "createdAt",
          "email",
          "expiresAt",
          "id",
          "locationIds",
          "revokedAt",
          "roleId",
          "roleName",
          "status",
        ].sort(),
      );
    }
  });

  it("orders open, then expired, then closed, each newest first, with statuses", async () => {
    world.unclosed = [
      row("expired1", { expires_at: iso(-day) }),
      row("open1"),
      row("open2", { created_at: iso(-2 * day) }),
    ];
    world.closed = [
      row("accepted1", { accepted_at: iso(-day / 2) }),
      row("revoked1", { revoked_at: iso(-day / 2) }),
    ];
    const r = await listInvitations({ orgId: ORG });
    expect(r.ok && r.data.invitations.map((i) => [i.id, i.status])).toEqual([
      ["open1", "open"],
      ["open2", "open"],
      ["expired1", "expired"],
      ["accepted1", "accepted"],
      ["revoked1", "revoked"],
    ]);
  });

  it("handles a closed invitation whose role was deleted (role_id null)", async () => {
    world.closed = [row("gone", { role_id: null, revoked_at: iso(-day) })];
    const r = await listInvitations({ orgId: ORG });
    expect(r.ok && r.data.invitations[0]).toMatchObject({
      roleId: null,
      roleName: null,
      status: "revoked",
    });
  });

  it("gives the role name and the location IDs, and none for all locations", async () => {
    world.unclosed = [row("a"), row("b", { all_locations: true })];
    world.locations = [
      { invitation_id: "a", location_id: LOC1 },
      { invitation_id: "a", location_id: LOC2 },
    ];
    const r = await listInvitations({ orgId: ORG });
    expect(r.ok && r.data.invitations).toMatchObject([
      { id: "a", roleName: "Cashier", allLocations: false, locationIds: [LOC1, LOC2] },
      { id: "b", roleName: "Cashier", allLocations: true, locationIds: [] },
    ]);
  });

  it("limits the rows: 100 by default, the closed query takes only what is left", async () => {
    world.unclosed = Array.from({ length: 3 }, (_, i) => row(`o${i}`));
    await listInvitations({ orgId: ORG });
    const inv = world.queries.filter((q) => q.table === "staff_invitations");
    expect(inv.map((q) => q.limit)).toEqual([100, 97]);

    world.queries = [];
    world.unclosed = Array.from({ length: 5 }, (_, i) => row(`o${i}`));
    await listInvitations({ orgId: ORG, limit: "5" });
    expect(
      world.queries.filter((q) => q.table === "staff_invitations").map((q) => q.limit),
    ).toEqual([5]);
  });

  it("refuses a limit that is out of range, and a bad org ID", async () => {
    for (const limit of [0, 201, 1.5, "x", -1]) {
      expect(await listInvitations({ orgId: ORG, limit })).toMatchObject({
        error: { code: "validation" },
      });
    }
    expect(await listInvitations({ orgId: "nope" })).toMatchObject({
      error: { code: "validation", fieldErrors: { orgId: ["staff.org.invalid"] } },
    });
    expect(world.queries).toEqual([]);
  });

  it("ignores another org's ID in the request: reads only the verified org", async () => {
    // getOrgContext answers for the caller's org; the value the caller sent is not used for reads.
    await listInvitations({ orgId: OTHER_ORG });
    expect(world.queries.every((q) => q.eq.org_id === ORG)).toBe(true);
  });

  it.each(["unclosed", "closed", "locations", "roles"] as const)(
    "a failed read (%s) is unavailable, never a partial list",
    async (which) => {
      world.unclosed = [row("a")];
      world.closed = [row("c", { revoked_at: iso(-day) })];
      world.fail = which;
      expect(await listInvitations({ orgId: ORG, limit: 100 })).toEqual({
        ok: false,
        error: { code: "unavailable" },
      });
    },
  );

  it("an org with no invitations is an empty list", async () => {
    expect(await listInvitations({ orgId: ORG })).toEqual({ ok: true, data: { invitations: [] } });
  });
});
