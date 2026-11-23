import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- stubs: no real Supabase, no Next runtime -------------------------------------------------
vi.mock("server-only", () => ({}));
const tags: string[] = [];
const updated: string[] = [];
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: (...t: string[]) => tags.push(...t),
  updateTag: (t: string) => updated.push(t),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

type Row = {
  org_id: string;
  org_slug: string;
  org_name: string;
  org_status: "active" | "suspended";
  member_id: string;
  member_status: "active" | "deactivated";
  role_id: string;
  role_key: string | null;
  role_name: string;
};
const db = {
  claims: null as null | { sub: string; email?: string },
  claimsError: false,
  memberships: [] as Row[],
  permissions: {} as Record<string, string[]>,
  packages: {} as Record<string, object[]>,
  failing: new Set<string>(),
  admins: new Set<string>(),
  adminError: false,
  calls: [] as { name: string; args: unknown }[],
};

vi.mock("../supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () =>
        db.claimsError
          ? { data: null, error: new Error("x") }
          : { data: db.claims ? { claims: db.claims } : null, error: null },
    },
    rpc: async (name: string, args: { p_org_id: string | null }) => {
      db.calls.push({ name, args });
      if (db.failing.has(name)) return { data: null, error: { message: "boom" } };
      if (name === "my_org_membership") {
        const mine = db.memberships;
        return {
          data: args.p_org_id ? mine.filter((r) => r.org_id === args.p_org_id) : mine,
          error: null,
        };
      }
      // Like the SQL functions: only an active member of an active org gets anything.
      const row = db.memberships.find((r) => r.org_id === args.p_org_id);
      const active = row?.member_status === "active" && row.org_status === "active";
      if (name === "my_permissions")
        return { data: active ? (db.permissions[args.p_org_id!] ?? []) : [], error: null };
      if (name === "get_org_package")
        return { data: active ? (db.packages[args.p_org_id!] ?? []) : [], error: null };
      return { data: null, error: { message: "unknown" } };
    },
  }),
}));
vi.mock("../supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            db.calls.push({ name: `admin:${table}`, args: id });
            if (db.adminError) return { data: null, error: { message: "boom" } };
            return { data: db.admins.has(id) ? { user_id: id } : null, error: null };
          },
        }),
      }),
    }),
  }),
}));

import {
  PERMISSION_KEYS,
  fail,
  getCurrentUser,
  getMembership,
  getOrgContext,
  hasFeature,
  hasPermission,
  loginUrl,
  memberTag,
  ok,
  refreshMemberAccess,
  refreshOrgPackage,
  requireFeature,
  requirePermission,
  requirePlatformAdmin,
  requireUser,
  safeNextPath,
} from "./index";

// ---- fixtures ---------------------------------------------------------------------------------
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (o: Partial<Row> = {}): Row => ({
  org_id: ORG_A,
  org_slug: "demo-a",
  org_name: "Demo A",
  org_status: "active",
  member_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  member_status: "active",
  role_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  role_key: "manager",
  role_name: "Manager",
  ...o,
});
const pkg = (features: Record<string, boolean> = {}) => ({
  package_key: "pro",
  package_name: "Pro",
  subscription_status: "active",
  trial_ends_at: null,
  current_period_end: null,
  max_locations: 3,
  max_staff: 20,
  max_tables: 50,
  features: { custom_roles: false, online_payments: true, ...features },
});

beforeEach(() => {
  tags.length = 0;
  updated.length = 0;
  Object.assign(db, {
    claims: { sub: U1, email: "someone@example.com" },
    claimsError: false,
    memberships: [row()],
    permissions: { [ORG_A]: ["orders.view", "pos.use"] },
    packages: { [ORG_A]: [pkg()] },
    adminError: false,
    calls: [],
  });
  db.failing.clear();
  db.admins.clear();
});

const rpcCalled = (name: string) => db.calls.some((c) => c.name === name);

// ---- tests ------------------------------------------------------------------------------------
describe("getCurrentUser / requireUser", () => {
  it("returns the verified user", async () => {
    expect(await getCurrentUser()).toEqual({ id: U1, email: "someone@example.com" });
  });

  it.each([
    ["no session", () => (db.claims = null)],
    ["a claims error", () => (db.claimsError = true)],
    ["a sub that is not a uuid", () => (db.claims = { sub: "not-a-uuid" })],
    ["a missing sub", () => (db.claims = {} as never)],
  ])("is null for %s", async (_n, set) => {
    set();
    expect(await getCurrentUser()).toBeNull();
  });

  it("requireUser redirects to login with a safe next", async () => {
    db.claims = null;
    await expect(requireUser({ next: "/app/demo-a/orders" })).rejects.toMatchObject({
      url: "/login?next=%2Fapp%2Fdemo-a%2Forders",
    });
    await expect(requireUser({ next: "https://evil.example" })).rejects.toMatchObject({
      url: "/login",
    });
    await expect(requireUser()).rejects.toMatchObject({ url: "/login" });
  });

  it("requireUser returns the user when signed in", async () => {
    expect((await requireUser()).id).toBe(U1);
  });
});

describe("safeNextPath", () => {
  it.each(["/app", "/app/x?y=1#z", "/a/b/c"])("keeps %s", (p) => expect(safeNextPath(p)).toBe(p));
  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "app",
    "",
    "/a\\b",
    "/a\u0000b",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "x".repeat(600),
    null,
    undefined,
    42,
    {},
  ])("replaces %j", (p) => expect(safeNextPath(p)).toBe("/app"));
  it("loginUrl omits an unsafe or root next", () => {
    expect(loginUrl("//x")).toBe("/login");
    expect(loginUrl("/")).toBe("/login");
  });
});

describe("getOrgContext: who gets in", () => {
  it("gives an active member of an active org its context", async () => {
    const r = await getOrgContext({ slug: "demo-a" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ctx.org).toEqual({ id: ORG_A, slug: "demo-a", name: "Demo A" });
    expect(r.ctx.member.roleKey).toBe("manager");
    expect([...r.ctx.permissions].sort()).toEqual(["orders.view", "pos.use"]);
    expect(r.ctx.package?.package_key).toBe("pro");
    expect((await getOrgContext({ orgId: ORG_A })).ok).toBe(true);
  });

  it("refuses with no session", async () => {
    db.claims = null;
    expect(await getOrgContext({ slug: "demo-a" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a suspended org, and fetches no permissions or package", async () => {
    db.memberships = [row({ org_status: "suspended" })];
    expect(await getOrgContext({ slug: "demo-a" })).toEqual({ ok: false, reason: "org_suspended" });
    expect(rpcCalled("my_permissions")).toBe(false);
    expect(rpcCalled("get_org_package")).toBe(false);
  });

  it("refuses a deactivated member, and fetches no permissions or package", async () => {
    db.memberships = [row({ member_status: "deactivated" })];
    expect(await getOrgContext({ orgId: ORG_A })).toEqual({
      ok: false,
      reason: "member_deactivated",
    });
    expect(rpcCalled("my_permissions")).toBe(false);
  });

  it("shows the suspended notice, not 'deactivated', when both apply", async () => {
    db.memberships = [row({ org_status: "suspended", member_status: "deactivated" })];
    expect(await getOrgContext({ slug: "demo-a" })).toEqual({ ok: false, reason: "org_suspended" });
  });

  it("refuses a non-member", async () => {
    db.memberships = [];
    expect(await getOrgContext({ slug: "demo-a" })).toEqual({ ok: false, reason: "no_membership" });
  });

  it("refuses another tenant's org, by id and by slug, the same as a missing one", async () => {
    // U1 belongs to A only. B exists, but is not theirs.
    expect(await getOrgContext({ orgId: ORG_B })).toEqual({ ok: false, reason: "no_membership" });
    expect(await getOrgContext({ slug: "demo-b" })).toEqual({ ok: false, reason: "no_membership" });
    expect(await getOrgContext({ slug: "does-not-exist" })).toEqual({
      ok: false,
      reason: "no_membership",
    });
    expect(
      db.calls.some(
        (c) =>
          (c.args as { p_org_id?: string }).p_org_id === ORG_B && c.name !== "my_org_membership",
      ),
    ).toBe(false);
  });

  it("does not let a slug match across tenants when the user is in two orgs", async () => {
    db.memberships = [row(), row({ org_id: ORG_B, org_slug: "demo-b", org_name: "B" })];
    db.permissions[ORG_B] = ["orders.void"];
    db.packages[ORG_B] = [pkg()];
    const r = await getOrgContext({ slug: "demo-b" });
    expect(r.ok && r.ctx.org.id).toBe(ORG_B);
    expect(r.ok && [...r.ctx.permissions]).toEqual(["orders.void"]);
  });

  it.each(["my_org_membership", "my_permissions", "get_org_package"])(
    "fails closed when %s errors",
    async (name) => {
      db.failing.add(name);
      expect(await getOrgContext({ slug: "demo-a" })).toEqual({ ok: false, reason: "unavailable" });
    },
  );

  it("fails closed on a malformed row", async () => {
    db.memberships = [{ ...row(), org_status: "weird" as never }];
    expect(await getOrgContext({ slug: "demo-a" })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("getMembership works on its own", async () => {
    const r = await getMembership(U1, { slug: "demo-a" });
    expect(r.ok && r.membership.org_id).toBe(ORG_A);
    expect(r.ok && "org_status" in r.membership).toBe(false);
  });
});

describe("permissions by role", () => {
  const roles: Record<string, string[]> = {
    owner: [...PERMISSION_KEYS],
    manager: PERMISSION_KEYS.filter(
      (k) => !["billing.manage", "settings.manage", "locations.manage"].includes(k),
    ),
    cashier: ["orders.view", "orders.create", "pos.use", "payments.take", "bills.print"],
    waiter: ["orders.view", "orders.create", "tables.view"],
    kitchen: ["kitchen.view", "kitchen.update"],
  };
  it.each(Object.entries(roles))("%s holds exactly its set", async (role, set) => {
    db.permissions[ORG_A] = set;
    const r = await getOrgContext({ slug: "demo-a" });
    if (!r.ok) throw new Error("no context");
    for (const key of PERMISSION_KEYS) {
      expect(hasPermission(r.ctx, key)).toBe(set.includes(key));
      expect(requirePermission(r.ctx, key).ok).toBe(set.includes(key));
    }
    expect(role).toBeTruthy();
  });

  it("returns a typed forbidden result", async () => {
    const r = await getOrgContext({ slug: "demo-a" });
    if (!r.ok) throw new Error("no context");
    expect(requirePermission(r.ctx, "staff.manage")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(requirePermission(r.ctx, "pos.use")).toEqual({ ok: true, data: undefined });
  });

  it("never holds an unknown key, even one that was granted", async () => {
    db.permissions[ORG_A] = ["made.up"];
    const r = await getOrgContext({ slug: "demo-a" });
    if (!r.ok) throw new Error("no context");
    expect(hasPermission(r.ctx, "made.up" as never)).toBe(false);
  });
});

describe("hasFeature", () => {
  it("reads the package features", async () => {
    const r = await getOrgContext({ slug: "demo-a" });
    if (!r.ok) throw new Error("no context");
    expect(hasFeature(r.ctx, "online_payments")).toBe(true);
    expect(hasFeature(r.ctx, "custom_roles")).toBe(false);
    expect(hasFeature(r.ctx, "loyalty")).toBe(false); // absent means off
    expect(hasFeature(r.ctx, "made_up" as never)).toBe(false);
    expect(requireFeature(r.ctx, "custom_roles")).toEqual({
      ok: false,
      error: { code: "feature_unavailable" },
    });
    expect(requireFeature(r.ctx, "online_payments").ok).toBe(true);
  });

  it("has no features without a running subscription", async () => {
    db.packages[ORG_A] = [];
    const r = await getOrgContext({ slug: "demo-a" });
    if (!r.ok) throw new Error("no context");
    expect(r.ctx.package).toBeNull();
    expect(hasFeature(r.ctx, "online_payments")).toBe(false);
  });
});

describe("requirePlatformAdmin", () => {
  it("is true for a listed user, by the verified id", async () => {
    db.admins.add(U1);
    expect(await requirePlatformAdmin()).toEqual({ ok: true, data: { userId: U1 } });
    expect(db.calls).toContainEqual({ name: "admin:platform_admins", args: U1 });
  });
  it("is false for anyone else", async () => {
    db.admins.add(U2);
    expect(await requirePlatformAdmin()).toEqual({
      ok: false,
      error: { code: "not_platform_admin" },
    });
  });
  it("is unauthenticated with no session, and asks nothing", async () => {
    db.claims = null;
    db.admins.add(U1);
    expect(await requirePlatformAdmin()).toEqual({ ok: false, error: { code: "unauthenticated" } });
    expect(rpcCalled("admin:platform_admins")).toBe(false);
  });
  it("fails closed when the lookup errors", async () => {
    db.admins.add(U1);
    db.adminError = true;
    expect(await requirePlatformAdmin()).toEqual({
      ok: false,
      error: { code: "not_platform_admin" },
    });
  });
  it("is not granted by being an org owner", async () => {
    db.memberships = [row({ role_key: "owner" })];
    expect((await requirePlatformAdmin()).ok).toBe(false);
  });
});

describe("cache keys and tags hold ids only", () => {
  it("tags are built from ids", async () => {
    await getOrgContext({ slug: "demo-a" });
    expect(tags).toContain(`user:${U1}:memberships`);
    expect(tags).toContain(memberTag(ORG_A, U1));
    expect(tags).toContain(`org:${ORG_A}:package`);
    const uuid = /^[0-9a-f-]{36}$/i;
    for (const tag of tags) {
      for (const part of tag
        .split(":")
        .filter((p) => !["user", "org", "member", "memberships", "package"].includes(p))) {
        expect(part).toMatch(uuid);
      }
      expect(tag).not.toMatch(/@|demo-a|someone|Demo/);
    }
  });

  it("the refresh helpers update those same tags", () => {
    refreshMemberAccess(ORG_A, U1);
    refreshOrgPackage(ORG_A);
    expect(updated).toEqual([
      `user:${U1}:memberships`,
      memberTag(ORG_A, U1),
      `org:${ORG_A}:package`,
    ]);
  });
});

describe("result helpers", () => {
  it("builds the one shape", () => {
    expect(ok(5)).toEqual({ ok: true, data: 5 });
    expect(fail("validation", { email: ["invalid"] })).toEqual({
      ok: false,
      error: { code: "validation", fieldErrors: { email: ["invalid"] } },
    });
  });
});
