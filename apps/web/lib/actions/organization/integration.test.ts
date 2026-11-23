// End to end against the local Supabase stack (`pnpm db:start`): the real action, the real RPC and
// the real access layer. Skipped unless RESTOMATE_IT_SUPABASE_URL, RESTOMATE_IT_ANON_KEY and
// RESTOMATE_IT_SERVICE_ROLE_KEY are set (from `supabase status -o json`), so CI's unit job is not
// affected. Only Next's request APIs are stubbed: the signed-in user's session is the cookie.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL_ = process.env.RESTOMATE_IT_SUPABASE_URL;
const ANON = process.env.RESTOMATE_IT_ANON_KEY;
const SERVICE = process.env.RESTOMATE_IT_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && ANON && SERVICE);

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));

import { PERMISSION_KEYS, getOrgContext } from "../../auth";
import { checkSlug, createOrganization } from "./actions";

const run = Math.random().toString(36).slice(2, 8);
const email = `it-owner-${run}@example.com`;
const password = `it-${run}-Password!`;
const slug = `it-resto-${run}`;
let userId = "";

describe.skipIf(!enabled)("create a restaurant, end to end (local stack)", () => {
  const admin = enabled
    ? createSupabaseClient(URL_!, SERVICE!, { auth: { persistSession: false } })
    : (null as never);

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ANON!);
    vi.stubEnv("ARCJET_KEY", ""); // no key: the presets fail open, as in local dev

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.code}`);
    userId = created.data.user.id;

    // Sign in and put the session where @supabase/ssr reads it: sb-<first host label>-auth-token.
    const anon = createSupabaseClient(URL_!, ANON!, { auth: { persistSession: false } });
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn: ${signIn.error.code}`);
    const ref = new URL(URL_!).hostname.split(".")[0];
    jar.set(`sb-${ref}-auth-token`, JSON.stringify(signIn.data.session));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!userId) return;
    // Remove what this run made. Orgs first (members, roles, locations cascade), then the user.
    const { data } = await admin
      .from("organization_members")
      .select("org_id")
      .eq("user_id", userId);
    for (const { org_id } of data ?? [])
      await admin.from("organizations").delete().eq("id", org_id);
    await admin.auth.admin.deleteUser(userId);
  });

  it("the slug is free before, taken after, and the user lands as Owner with every permission", async () => {
    expect(await checkSlug(slug)).toEqual({ ok: true, data: { available: true, reason: null } });

    const result = await createOrganization({
      name: "IT Warung",
      slug,
      timezone: "Asia/Makassar",
      taxBps: 1100,
      serviceChargeBps: 500,
      taxOnService: true,
    });
    expect(result).toMatchObject({ ok: true, data: { slug } });
    if (!result.ok) return;

    const ctx = await getOrgContext({ orgId: result.data.orgId });
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;
    expect(ctx.ctx.user.id).toBe(userId);
    expect(ctx.ctx.member.roleKey).toBe("owner");
    expect([...ctx.ctx.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());

    expect(await checkSlug(slug)).toEqual({
      ok: true,
      data: { available: false, reason: "SLUG_TAKEN" },
    });
  });

  it("a second submit of the same form is SLUG_TAKEN, never a second org", async () => {
    const again = await createOrganization({ name: "IT Warung", slug });
    expect(again).toEqual({
      ok: false,
      error: { code: "conflict", fieldErrors: { slug: ["org.slug.taken"] } },
    });
    const { count } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("slug", slug);
    expect(count).toBe(1);
  });

  it("a reserved slug from the database is SLUG_RESERVED", async () => {
    const { data: reserved } = await admin.from("reserved_slugs").select("slug").limit(1);
    const word = reserved?.[0]?.slug;
    if (word) {
      expect(await checkSlug(word)).toEqual({
        ok: true,
        data: { available: false, reason: "SLUG_RESERVED" },
      });
    }
  });
});
