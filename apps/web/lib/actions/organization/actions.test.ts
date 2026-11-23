import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const updated: string[] = [];
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  updateTag: (t: string) => updated.push(t),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const U1 = "11111111-1111-4111-8111-111111111111";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const world = {
  order: [] as string[],
  user: { id: U1, email: "owner@example.com" } as
    null | "unavailable" | { id: string; email: string },
  protect: { allowed: true } as
    { allowed: true } | { allowed: false; reason: "rate_limited" | "blocked" },
  rpc: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  protectArgs: [] as unknown[],
};

vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => {
    world.order.push("user");
    return world.user;
  },
}));
vi.mock("../../arcjet/organization", () => ({
  protectOrg: async (...args: unknown[]) => {
    world.order.push("protect");
    world.protectArgs.push(args);
    return world.protect;
  },
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

import { checkSlug, createOrganization } from "./actions";

const dbError = (message: string, code = "P0001") => ({ data: null, error: { code, message } });

beforeEach(() => {
  updated.length = 0;
  Object.assign(world, {
    order: [],
    user: { id: U1, email: "owner@example.com" },
    protect: { allowed: true },
    rpc: {},
    calls: [],
    protectArgs: [],
  });
});

describe("checkSlug", () => {
  it("asks the database for a valid slug, after the user check and the rate limit", async () => {
    world.rpc.is_slug_available = () => ({
      data: [{ available: true, reason: null }],
      error: null,
    });
    expect(await checkSlug("  Warung-Sedap ")).toEqual({
      ok: true,
      data: { available: true, reason: null },
    });
    expect(world.calls).toEqual([{ fn: "is_slug_available", args: { p_slug: "warung-sedap" } }]);
    expect(world.order).toEqual(["user", "protect", "rpc:is_slug_available"]);
    expect(world.protectArgs).toEqual([["slugCheck", { userId: U1 }]]);
  });

  it.each(["SLUG_RESERVED", "SLUG_TAKEN"])("passes on the database's %s", async (reason) => {
    world.rpc.is_slug_available = () => ({ data: [{ available: false, reason }], error: null });
    expect(await checkSlug("admin")).toEqual({ ok: true, data: { available: false, reason } });
  });

  it("an unknown answer from the database is never 'available'", async () => {
    world.rpc.is_slug_available = () => ({
      data: [{ available: false, reason: "SOMETHING_NEW" }],
      error: null,
    });
    expect(await checkSlug("abc")).toEqual({
      ok: true,
      data: { available: false, reason: "SLUG_INVALID" },
    });
  });

  it.each(["ab", "a".repeat(41), "-abc", "abc-", "ab--c", "ab_c", "ab c", "abç", ""])(
    "answers SLUG_INVALID for %j without asking the database (the database's rules)",
    async (slug) => {
      expect(await checkSlug(slug)).toEqual({
        ok: true,
        data: { available: false, reason: "SLUG_INVALID" },
      });
      expect(world.calls).toEqual([]);
    },
  );

  it.each(["abc", "a1b", "warung-sedap-2", "a".repeat(40), "123"])(
    "accepts %j as valid",
    async (slug) => {
      world.rpc.is_slug_available = () => ({
        data: [{ available: true, reason: null }],
        error: null,
      });
      expect((await checkSlug(slug)).ok).toBe(true);
      expect(world.calls).toHaveLength(1);
    },
  );

  it("refuses non-strings, signed-out users, outages and rate limits", async () => {
    expect(await checkSlug(42)).toMatchObject({ ok: false, error: { code: "validation" } });
    world.user = null;
    expect(await checkSlug("abc")).toEqual({ ok: false, error: { code: "unauthenticated" } });
    world.user = "unavailable";
    expect(await checkSlug("abc")).toEqual({ ok: false, error: { code: "unavailable" } });
    world.user = { id: U1, email: "x@y.co" };
    world.protect = { allowed: false, reason: "rate_limited" };
    expect(await checkSlug("abc")).toEqual({ ok: false, error: { code: "rate_limited" } });
    expect(world.calls).toEqual([]);
  });

  it("a database or network failure is unavailable, never 'available'", async () => {
    world.rpc.is_slug_available = () => ({
      data: null,
      error: { code: "", message: "TypeError: fetch failed" },
    });
    expect(await checkSlug("abc")).toEqual({ ok: false, error: { code: "unavailable" } });
    world.rpc.is_slug_available = () => ({ data: [], error: null });
    expect(await checkSlug("abc")).toEqual({ ok: false, error: { code: "unavailable" } });
  });
});

describe("createOrganization", () => {
  const form = {
    name: "  Warung Sedap ",
    slug: "Warung-Sedap",
    timezone: "Asia/Makassar",
    locationName: "Kuta",
    address: "Jl. Raya 1",
    taxBps: "1100",
    serviceChargeBps: "500",
    taxOnService: "on",
  };
  const created = () => ({
    data: [{ new_org_id: ORG, new_org_slug: "warung-sedap" }],
    error: null,
  });

  it("creates the org, refreshes the caller's memberships and returns its ID and slug", async () => {
    world.rpc.create_organization = created;
    expect(await createOrganization(form)).toEqual({
      ok: true,
      data: { orgId: ORG, slug: "warung-sedap" },
    });
    expect(world.calls[0]).toEqual({
      fn: "create_organization",
      args: {
        p_name: "Warung Sedap",
        p_slug: "warung-sedap",
        p_timezone: "Asia/Makassar",
        p_location_name: "Kuta",
        p_address: "Jl. Raya 1",
        p_tax_bps: 1100,
        p_service_charge_bps: 500,
        p_tax_on_service: true,
      },
    });
    expect(world.order).toEqual(["user", "protect", "rpc:create_organization"]);
    expect(world.protectArgs).toEqual([["createOrg", { userId: U1 }]]);
    expect(updated).toEqual([`user:${U1}:memberships`, `org:${ORG}:member:${U1}`]);
  });

  it("uses the defaults: Asia/Jakarta, 0 bps, no tax on service, no location name or address", async () => {
    world.rpc.create_organization = created;
    const fd = new FormData();
    fd.set("name", "Kopi");
    fd.set("slug", "kopi");
    fd.set("timezone", "");
    fd.set("taxBps", "");
    await createOrganization(fd);
    expect(world.calls[0].args).toEqual({
      p_name: "Kopi",
      p_slug: "kopi",
      p_timezone: "Asia/Jakarta",
      p_location_name: undefined,
      p_address: undefined,
      p_tax_bps: 0,
      p_service_charge_bps: 0,
      p_tax_on_service: false,
    });
  });

  it("validates first, with keys per field and no database call", async () => {
    const r = await createOrganization({
      name: "",
      slug: "a--b",
      timezone: "UTC+7",
      address: "x".repeat(501),
      taxBps: "10001",
      serviceChargeBps: "2.5",
      taxOnService: "maybe",
    });
    expect(r).toEqual({
      ok: false,
      error: {
        code: "validation",
        fieldErrors: {
          name: ["org.field.required"],
          slug: ["org.slug.invalid"],
          timezone: ["org.timezone.invalid"],
          address: ["org.address.too_long"],
          taxBps: ["org.bps.invalid"],
          serviceChargeBps: ["org.bps.invalid"],
          taxOnService: ["org.field.invalid"],
        },
      },
    });
    expect(world.order).toEqual([]);
  });

  it.each(["US/Eastern", "Etc/GMT-7", "EST5EDT", "Asia/Nowhere", "posix/Asia/Jakarta"])(
    "refuses the timezone %j as the database does",
    async (timezone) => {
      expect(await createOrganization({ ...form, timezone })).toMatchObject({
        error: { fieldErrors: { timezone: ["org.timezone.invalid"] } },
      });
    },
  );

  it.each([
    [dbError("NAME_INVALID"), { code: "validation", fieldErrors: { name: ["org.name.invalid"] } }],
    [dbError("SLUG_INVALID"), { code: "validation", fieldErrors: { slug: ["org.slug.invalid"] } }],
    [
      dbError("SLUG_RESERVED"),
      { code: "validation", fieldErrors: { slug: ["org.slug.reserved"] } },
    ],
    [dbError("SLUG_TAKEN"), { code: "conflict", fieldErrors: { slug: ["org.slug.taken"] } }],
    [dbError("ORG_CAP"), { code: "forbidden", fieldErrors: { form: ["org.cap_reached"] } }],
    [
      dbError("PLAN_LIMIT:locations"),
      { code: "feature_unavailable", fieldErrors: { form: ["org.plan_limit.locations"] } },
    ],
    [
      dbError("invalid timezone", "22023"),
      { code: "validation", fieldErrors: { timezone: ["org.timezone.invalid"] } },
    ],
    [
      dbError('new row violates check constraint "locations_address_check"', "23514"),
      { code: "validation", fieldErrors: { form: ["org.field.invalid"] } },
    ],
    [dbError("UNAUTHENTICATED", "28000"), { code: "unauthenticated" }],
    [dbError("canceling statement due to statement timeout", "57014"), { code: "unavailable" }],
    [
      { data: null, error: { code: "", message: "TypeError: fetch failed" } },
      { code: "unavailable" },
    ],
    [dbError("something else entirely", "XX000"), { code: "unknown" }],
  ])("maps %j to a stable code with no database text", async (answer, error) => {
    world.rpc.create_organization = () => answer;
    const r = await createOrganization(form);
    expect(r).toEqual({ ok: false, error });
    expect(JSON.stringify(r)).not.toMatch(/constraint|fetch failed|statement|entirely/);
    expect(updated).toEqual([]);
  });

  it("a double submit gives SLUG_TAKEN for the second, never a second org", async () => {
    const taken = new Set<string>();
    world.rpc.create_organization = (args) => {
      if (taken.has(String(args.p_slug))) return dbError("SLUG_TAKEN");
      taken.add(String(args.p_slug));
      return created();
    };
    const [first, second] = await Promise.all([createOrganization(form), createOrganization(form)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect([first, second].find((r) => !r.ok)).toEqual({
      ok: false,
      error: { code: "conflict", fieldErrors: { slug: ["org.slug.taken"] } },
    });
    expect(taken.size).toBe(1);
  });

  it("refuses signed-out users, outages and rate limits before the database", async () => {
    world.user = null;
    expect(await createOrganization(form)).toEqual({
      ok: false,
      error: { code: "unauthenticated" },
    });
    world.user = "unavailable";
    expect(await createOrganization(form)).toEqual({ ok: false, error: { code: "unavailable" } });
    world.user = { id: U1, email: "x@y.co" };
    world.protect = { allowed: false, reason: "blocked" };
    expect(await createOrganization(form)).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(world.calls).toEqual([]);
  });

  it("an empty answer is unknown and refreshes nothing", async () => {
    world.rpc.create_organization = () => ({ data: [], error: null });
    expect(await createOrganization(form)).toEqual({ ok: false, error: { code: "unknown" } });
    expect(updated).toEqual([]);
  });
});
