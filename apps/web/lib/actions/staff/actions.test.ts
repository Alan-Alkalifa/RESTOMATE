import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const updated: string[] = [];
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  updateTag: (t: string) => updated.push(t),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const LOC = "44444444-4444-4444-8444-444444444444";
const TOKEN = "A".repeat(43);

const world = {
  order: [] as string[],
  user: { id: ME, email: "me@example.com" } as null | "unavailable" | { id: string; email: string },
  permissions: ["staff.manage"] as string[],
  context: "ok" as "ok" | "no_membership" | "unavailable",
  rpc: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  member: { data: { user_id: THEM }, error: null } as { data: unknown; error: unknown },
  calls: [] as { fn: string; args: unknown }[],
};

vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => {
    world.order.push("user");
    return world.user;
  },
}));
vi.mock("../../auth/org", async (original) => ({
  ...(await original<typeof import("../../auth/org")>()),
  getOrgContext: async () => {
    world.order.push("context");
    if (world.context !== "ok") return { ok: false, reason: world.context };
    return {
      ok: true,
      ctx: {
        user: { id: ME, email: "me@example.com" },
        org: { id: ORG, slug: "warung", name: "Warung" },
        member: { id: "m0", roleId: "r0", roleKey: "cashier", roleName: "Cashier" },
        permissions: new Set(world.permissions),
        package: null,
      },
    };
  },
}));
vi.mock("../../supabase/server", () => ({
  createClient: async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => {
        world.order.push("select:organization_members");
        return world.member;
      },
    };
    return {
      from: () => query,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        world.order.push(`rpc:${fn}`);
        world.calls.push({ fn, args });
        return world.rpc[fn]?.(args) ?? { data: null, error: null };
      },
    };
  },
}));

import { acceptInvitation, setMemberLocations } from "./actions";

const joined = () => ({
  data: [{ joined_org_id: ORG, joined_org_slug: "warung", joined_member_id: MEMBER }],
  error: null,
});

beforeEach(() => {
  updated.length = 0;
  Object.assign(world, {
    order: [],
    user: { id: ME, email: "me@example.com" },
    permissions: ["staff.manage"],
    context: "ok",
    rpc: {},
    member: { data: { user_id: THEM }, error: null },
    calls: [],
  });
});

describe("acceptInvitation", () => {
  it("accepts with the raw token, refreshes the new member's access and returns the org", async () => {
    world.rpc.accept_invitation = joined;
    expect(await acceptInvitation({ token: TOKEN })).toEqual({
      ok: true,
      data: { orgId: ORG, slug: "warung" },
    });
    expect(world.calls).toEqual([{ fn: "accept_invitation", args: { p_token: TOKEN } }]);
    expect(updated).toEqual([`user:${ME}:memberships`, `org:${ORG}:member:${ME}`]);
  });

  it("needs no staff.manage (the invitee is not a member yet)", async () => {
    world.permissions = [];
    world.context = "no_membership";
    world.rpc.accept_invitation = joined;
    expect((await acceptInvitation({ token: TOKEN })).ok).toBe(true);
    expect(world.order).not.toContain("context");
  });

  it("a malformed token is invalid_token without asking the database", async () => {
    for (const token of ["", "short", "A".repeat(44), `${"A".repeat(42)}=`, undefined, 42]) {
      expect(await acceptInvitation({ token })).toEqual({
        ok: false,
        error: { code: "invalid_token" },
      });
    }
    expect(world.calls).toEqual([]);
  });

  it("maps the database's answers and refreshes nothing on a refusal", async () => {
    world.rpc.accept_invitation = () => ({
      data: null,
      error: { code: "P0001", message: "INVITATION_INVALID" },
    });
    expect(await acceptInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "invalid_token" },
    });
    world.rpc.accept_invitation = () => ({
      data: null,
      error: { code: "P0001", message: "ALREADY_MEMBER" },
    });
    expect(await acceptInvitation({ token: TOKEN })).toMatchObject({ error: { code: "conflict" } });
    expect(updated).toEqual([]);
  });

  it("needs a signed-in user", async () => {
    world.user = null;
    expect(await acceptInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "unauthenticated" },
    });
    world.user = "unavailable";
    expect(await acceptInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(world.calls).toEqual([]);
  });
});

describe("setMemberLocations", () => {
  const input = { orgId: ORG, memberId: MEMBER, locationIds: [LOC] };

  it("checks staff.manage first, then replaces the locations and refreshes that member", async () => {
    expect(await setMemberLocations(input)).toEqual({ ok: true, data: undefined });
    expect(world.order).toEqual([
      "context",
      "select:organization_members",
      "rpc:set_member_locations",
    ]);
    expect(world.calls).toEqual([
      { fn: "set_member_locations", args: { p_member_id: MEMBER, p_location_ids: [LOC] } },
    ]);
    expect(updated).toEqual([`user:${THEM}:memberships`, `org:${ORG}:member:${THEM}`]);
  });

  it("a Cashier (no staff.manage) gets forbidden and the database is not asked", async () => {
    world.permissions = ["orders.view", "pos.use"];
    expect(await setMemberLocations(input)).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(world.order).toEqual(["context"]);
  });

  it("passes on the context's refusal (not a member, outage)", async () => {
    world.context = "no_membership";
    expect(await setMemberLocations(input)).toEqual({
      ok: false,
      error: { code: "no_membership" },
    });
    world.context = "unavailable";
    expect(await setMemberLocations(input)).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("a member of another org is forbidden, as the RPC answers", async () => {
    world.member = { data: null, error: null };
    expect(await setMemberLocations(input)).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(world.calls).toEqual([]);
  });

  it("validates IDs and reads repeated FormData fields", async () => {
    expect(await setMemberLocations({ ...input, locationIds: ["nope"] })).toMatchObject({
      error: { code: "validation" },
    });
    const other = "55555555-5555-4555-8555-555555555555";
    const fd = new FormData();
    fd.set("orgId", ORG);
    fd.set("memberId", MEMBER);
    fd.append("locationIds", LOC);
    fd.append("locationIds", other);
    await setMemberLocations(fd);
    expect(world.calls[0]).toMatchObject({ args: { p_location_ids: [LOC, other] } });
  });

  it("maps LOCATION_INVALID and FORBIDDEN from the RPC", async () => {
    world.rpc.set_member_locations = () => ({
      data: null,
      error: { code: "P0001", message: "LOCATION_INVALID" },
    });
    expect(await setMemberLocations(input)).toMatchObject({ error: { code: "validation" } });
    world.rpc.set_member_locations = () => ({
      data: null,
      error: { code: "42501", message: "FORBIDDEN" },
    });
    expect(await setMemberLocations(input)).toEqual({ ok: false, error: { code: "forbidden" } });
  });
});
