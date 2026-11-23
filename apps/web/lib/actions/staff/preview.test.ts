import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const TOKEN = "A".repeat(43);

const world = {
  protect: { allowed: true } as
    { allowed: true } | { allowed: false; reason: "rate_limited" | "blocked" },
  protectCalls: 0,
  rpc: { data: [] as unknown, error: null as unknown },
  calls: [] as { fn: string; args: unknown }[],
  rpcOptions: [] as unknown[],
  order: [] as string[],
  userChecked: false,
};

vi.mock("../../arcjet/invitation", () => ({
  protectInvitationPreview: async () => {
    world.protectCalls++;
    world.order.push("protect");
    return world.protect;
  },
}));
vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => {
    world.userChecked = true;
    return null; // signed out: the preview must still work
  },
}));
vi.mock("../../supabase/stateless", () => ({
  createStatelessAuthClient: () => ({
    rpc: async (fn: string, args: unknown, options?: unknown) => {
      world.order.push(`rpc:${fn}`);
      world.calls.push({ fn, args });
      world.rpcOptions.push(options);
      return world.rpc;
    },
  }),
}));

import { previewInvitation } from "./actions";

const UNAVAILABLE = { status: "unavailable", orgName: null, orgSlug: null, roleName: null };
const row = (over: Record<string, unknown> = {}) => ({
  org_name: "Warung Sedap",
  org_slug: "warung",
  role_name: "Cashier",
  status: "open",
  ...over,
});

beforeEach(() => {
  Object.assign(world, {
    protect: { allowed: true },
    protectCalls: 0,
    rpc: { data: [row()], error: null },
    calls: [],
    rpcOptions: [],
    order: [],
    userChecked: false,
  });
});

describe("previewInvitation", () => {
  it("shows the org and role of an open invitation, without any sign-in", async () => {
    expect(await previewInvitation({ token: TOKEN })).toEqual({
      ok: true,
      data: { status: "open", orgName: "Warung Sedap", orgSlug: "warung", roleName: "Cashier" },
    });
    expect(world.userChecked).toBe(false); // it never asks who is signed in
    expect(world.calls).toEqual([{ fn: "get_invitation_preview", args: { p_token: TOKEN } }]);
    expect(world.order).toEqual(["protect", "rpc:get_invitation_preview"]); // limited first
  });

  it("an expired invitation still carries the names (the page says whom to ask)", async () => {
    world.rpc = { data: [row({ status: "expired" })], error: null };
    expect(await previewInvitation({ token: TOKEN })).toEqual({
      ok: true,
      data: { status: "expired", orgName: "Warung Sedap", orgSlug: "warung", roleName: "Cashier" },
    });
  });

  it("'unavailable' has all names null (the generated type says string, the database sends null)", async () => {
    world.rpc = {
      data: [{ org_name: null, org_slug: null, role_name: null, status: "unavailable" }],
      error: null,
    };
    expect(await previewInvitation({ token: TOKEN })).toEqual({ ok: true, data: UNAVAILABLE });
  });

  it.each([
    ["an unknown status", row({ status: "pending" })],
    ["open without an org name", row({ org_name: null })],
    ["open with an empty role", row({ role_name: "" })],
    ["open with a number as slug", row({ org_slug: 5 })],
    [
      "expired without names",
      row({ status: "expired", org_name: null, org_slug: null, role_name: null }),
    ],
    ["a missing status", row({ status: undefined })],
  ])("treats %s as unavailable, never as a half-filled preview", async (_, bad) => {
    world.rpc = { data: [bad], error: null };
    expect(await previewInvitation({ token: TOKEN })).toEqual({ ok: true, data: UNAVAILABLE });
  });

  it("returns only the four fields, even if the row carries more", async () => {
    world.rpc = {
      data: [row({ email: "siti@example.com", invitation_id: "x", org_id: "y", token_hash: "z" })],
      error: null,
    };
    const r = await previewInvitation({ token: TOKEN });
    expect(r.ok && Object.keys(r.data).sort()).toEqual([
      "orgName",
      "orgSlug",
      "roleName",
      "status",
    ]);
    expect(JSON.stringify(r)).not.toMatch(/siti|invitation_id|org_id|token_hash/);
  });

  it.each([
    "",
    "short",
    "A".repeat(44),
    `${"A".repeat(42)}=`,
    undefined,
    null,
    42,
    { a: 1 },
    ["x"],
  ])(
    "a token that can't be one (%j) is 'unavailable' without asking the database or the limiter",
    async (token) => {
      expect(await previewInvitation({ token })).toEqual({ ok: true, data: UNAVAILABLE });
      expect(world.calls).toEqual([]);
      expect(world.protectCalls).toBe(0);
    },
  );

  it("an unknown token and a used one look the same (the database answers 'unavailable' for both)", async () => {
    const unavailable = {
      data: [{ org_name: null, org_slug: null, role_name: null, status: "unavailable" }],
      error: null,
    };
    world.rpc = unavailable;
    const unknown = await previewInvitation({ token: TOKEN });
    const used = await previewInvitation({ token: "B".repeat(43) });
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(used));
  });

  it("is rate-limited per IP: a refusal stops before the database", async () => {
    world.protect = { allowed: false, reason: "rate_limited" };
    expect(await previewInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "rate_limited" },
    });
    world.protect = { allowed: false, reason: "blocked" };
    expect(await previewInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.calls).toEqual([]);
  });

  it("a database or network failure is unavailable (an error), not an 'unavailable' preview", async () => {
    world.rpc = { data: null, error: { code: "", message: "fetch failed" } };
    expect(await previewInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
    world.rpc = { data: [], error: null };
    expect(await previewInvitation({ token: TOKEN })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("asks the database with a POST (never GET, so the token stays out of access logs) and always sends p_token", async () => {
    await previewInvitation({ token: TOKEN });
    // supabase-js sends a GET only when called with `{ get: true }`; no options means POST.
    expect(world.rpcOptions).toEqual([undefined]);
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0].args).toEqual({ p_token: TOKEN });
    expect(Object.keys(world.calls[0].args as object)).toEqual(["p_token"]);
  });

  it("never puts the token in the result", async () => {
    const r = await previewInvitation({ token: TOKEN });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});
