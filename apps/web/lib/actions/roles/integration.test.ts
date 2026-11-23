// End to end against the local Supabase stack (`pnpm db:start`): the real actions, the real RPCs and
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

import { createOrganization } from "../organization/actions";
import { createRole, deleteRole, updateRole } from "./actions";

const run = Math.random().toString(36).slice(2, 8);
const password = `it-${run}-Password!`;
const users = {
  owner: { email: `it-roles-owner-${run}@example.com`, id: "" },
  manager: { email: `it-roles-manager-${run}@example.com`, id: "" },
  cashier: { email: `it-roles-cashier-${run}@example.com`, id: "" },
};
const slug = `it-roles-${run}`;
let orgId = "";
let trialHadCustomRoles = false;

describe.skipIf(!enabled)("custom roles, end to end (local stack)", () => {
  const admin = enabled
    ? createSupabaseClient(URL_!, SERVICE!, { auth: { persistSession: false } })
    : (null as never);

  /** Sign in as one of the users: the session goes where @supabase/ssr reads it. */
  async function as(who: keyof typeof users) {
    const anon = createSupabaseClient(URL_!, ANON!, { auth: { persistSession: false } });
    const signIn = await anon.auth.signInWithPassword({ email: users[who].email, password });
    if (signIn.error) throw new Error(`signIn ${who}: ${signIn.error.code}`);
    const ref = new URL(URL_!).hostname.split(".")[0];
    jar.set(`sb-${ref}-auth-token`, JSON.stringify(signIn.data.session));
  }
  const roleId = async (name: string) =>
    (await admin.from("roles").select("id").eq("org_id", orgId).eq("name", name).single()).data
      ?.id as string;
  const permissionsOf = async (id: string) =>
    ((await admin.from("role_permissions").select("permission_key").eq("role_id", id)).data ?? [])
      .map((r) => r.permission_key)
      .sort();

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ANON!);
    vi.stubEnv("ARCJET_KEY", ""); // no key: the presets fail open, as in local dev

    for (const u of Object.values(users)) {
      const created = await admin.auth.admin.createUser({
        email: u.email,
        password,
        email_confirm: true,
      });
      if (created.error) throw new Error(`createUser: ${created.error.code}`);
      u.id = created.data.user.id;
    }

    // The default package has no feature on: turn custom_roles on for the run, and put it back after.
    const trial = await admin
      .from("packages")
      .select("feature_custom_roles")
      .eq("key", "trial")
      .single();
    trialHadCustomRoles = trial.data?.feature_custom_roles === true;
    await admin.from("packages").update({ feature_custom_roles: true }).eq("key", "trial");

    await as("owner");
    const created = await createOrganization({ name: "IT Roles", slug });
    if (!created.ok) throw new Error(`createOrganization: ${created.error.code}`);
    orgId = created.data.orgId;

    // Members the guards are not asked about: no auth.uid(), as the server's admin client writes.
    for (const [who, key] of [
      ["manager", "manager"],
      ["cashier", "cashier"],
    ] as const) {
      const { data: role } = await admin
        .from("roles")
        .select("id")
        .eq("org_id", orgId)
        .eq("system_key", key)
        .single();
      const added = await admin
        .from("organization_members")
        .insert({ org_id: orgId, user_id: users[who].id, role_id: role!.id });
      if (added.error) throw new Error(`member ${who}: ${added.error.code}`);
    }
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    // The server's admin role can't delete an organization (by design), so the run's org (a unique
    // slug) stays in the local database until `supabase db reset`. Its users go, and with them
    // their memberships. The default package is put back as it was.
    await admin
      .from("packages")
      .update({ feature_custom_roles: trialHadCustomRoles })
      .eq("key", "trial");
    for (const u of Object.values(users)) if (u.id) await admin.auth.admin.deleteUser(u.id);
  });

  it("the Owner creates a role: name cleaned, permissions saved, audited", async () => {
    await as("owner");
    const r = await createRole({
      orgId,
      name: "  Bar⁠   Lead ",
      description: "Runs the bar",
      permissions: ["orders.view", "kitchen.view", "orders.view"],
    });
    expect(r.ok).toBe(true);
    const id = await roleId("Bar Lead");
    expect(id).toBeTruthy();
    expect(await permissionsOf(id)).toEqual(["kitchen.view", "orders.view"]);
    const { data: audit } = await admin
      .from("audit_logs")
      .select("actor_id")
      .eq("org_id", orgId)
      .eq("action", "role.created")
      .eq("entity_id", id);
    expect(audit).toEqual([{ actor_id: users.owner.id }]);
  });

  it("'owner' + U+2060, 'Owner  ' and 'bar  lead' are refused as duplicates, with a field error", async () => {
    await as("owner");
    for (const name of ["owner⁠", "Owner  ", "OWNER", "bar  lead", "Ｂａｒ Ｌｅａｄ"]) {
      expect(await createRole({ orgId, name })).toEqual({
        ok: false,
        error: { code: "conflict", fieldErrors: { name: ["roles.name.taken"] } },
      });
    }
    const { count } = await admin
      .from("roles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    expect(count).toBe(5 + 1); // five system roles and Bar Lead
  });

  it("update: absent keeps, '' clears the description, [] removes the permissions", async () => {
    await as("owner");
    const id = await roleId("Bar Lead");
    expect((await updateRole({ orgId, roleId: id, name: "Bar  Boss" })).ok).toBe(true);
    const { data: row } = await admin
      .from("roles")
      .select("name, description")
      .eq("id", id)
      .single();
    expect(row).toEqual({ name: "Bar Boss", description: "Runs the bar" });
    expect(await permissionsOf(id)).toEqual(["kitchen.view", "orders.view"]);

    expect((await updateRole({ orgId, roleId: id, description: "" })).ok).toBe(true);
    expect(
      (await admin.from("roles").select("description").eq("id", id).single()).data?.description,
    ).toBeNull();

    expect((await updateRole({ orgId, roleId: id, permissions: [] })).ok).toBe(true);
    expect(await permissionsOf(id)).toEqual([]);
    expect((await updateRole({ orgId, roleId: id, permissions: ["orders.view"] })).ok).toBe(true);
    expect(await permissionsOf(id)).toEqual(["orders.view"]);
  });

  it("a system role can't be changed or deleted", async () => {
    await as("owner");
    const cashier = await roleId("Cashier");
    const expected = {
      ok: false,
      error: { code: "forbidden", fieldErrors: { form: ["roles.system_role"] } },
    };
    expect(await updateRole({ orgId, roleId: cashier, name: "Till" })).toEqual(expected);
    expect(await deleteRole({ orgId, roleId: cashier })).toEqual(expected);
  });

  it("nobody grants a permission they lack: a Manager can't give billing.manage", async () => {
    await as("manager");
    expect(await createRole({ orgId, name: "Money", permissions: ["billing.manage"] })).toEqual({
      ok: false,
      error: { code: "forbidden", fieldErrors: { permissions: ["roles.permissions.not_held"] } },
    });
    expect(
      (await admin.from("roles").select("id").eq("org_id", orgId).eq("name", "Money")).data,
    ).toEqual([]);
    // What they hold, they can give.
    expect(
      (await createRole({ orgId, name: "Floor", permissions: ["tables.view", "orders.view"] })).ok,
    ).toBe(true);
  });

  it("a role holding a permission the Manager lacks can't be edited or deleted by them (the database says so)", async () => {
    await as("owner");
    expect((await createRole({ orgId, name: "Billing", permissions: ["billing.manage"] })).ok).toBe(
      true,
    );
    const id = await roleId("Billing");
    await as("manager");
    const denied = {
      ok: false,
      error: { code: "forbidden", fieldErrors: { permissions: ["roles.permissions.not_held"] } },
    };
    expect(await updateRole({ orgId, roleId: id, name: "Billing 2" })).toEqual(denied);
    expect(await updateRole({ orgId, roleId: id, permissions: ["orders.view"] })).toEqual(denied);
    expect(await deleteRole({ orgId, roleId: id })).toEqual(denied);
    expect(await permissionsOf(id)).toEqual(["billing.manage"]);
    await as("owner");
    expect((await deleteRole({ orgId, roleId: id })).ok).toBe(true);
  });

  it("a Cashier has no staff.manage", async () => {
    await as("cashier");
    expect(await createRole({ orgId, name: "Nope" })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await deleteRole({ orgId, roleId: await roleId("Floor") })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("a role someone holds can't be deleted; an unused one can; an unknown id is forbidden", async () => {
    await as("owner");
    const id = await roleId("Floor");
    await admin
      .from("organization_members")
      .update({ role_id: id })
      .eq("org_id", orgId)
      .eq("user_id", users.cashier.id);
    expect(await deleteRole({ orgId, roleId: id })).toEqual({
      ok: false,
      error: { code: "conflict", fieldErrors: { form: ["roles.in_use"] } },
    });
    const { data: back } = await admin
      .from("roles")
      .select("id")
      .eq("org_id", orgId)
      .eq("system_key", "cashier")
      .single();
    await admin
      .from("organization_members")
      .update({ role_id: back!.id })
      .eq("org_id", orgId)
      .eq("user_id", users.cashier.id);
    expect((await deleteRole({ orgId, roleId: id })).ok).toBe(true);
    expect((await admin.from("roles").select("id").eq("id", id)).data).toEqual([]);
    expect(await deleteRole({ orgId, roleId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("the package feature gates create and update, not delete", async () => {
    await as("owner");
    const id = await roleId("Bar Boss");
    await admin.from("packages").update({ feature_custom_roles: false }).eq("key", "trial");
    try {
      expect(await createRole({ orgId, name: "Gated" })).toMatchObject({
        ok: false,
        error: { code: "feature_unavailable" },
      });
      expect(await updateRole({ orgId, roleId: id, name: "Gated" })).toMatchObject({
        ok: false,
        error: { code: "feature_unavailable" },
      });
      expect((await deleteRole({ orgId, roleId: id })).ok).toBe(true);
    } finally {
      await admin.from("packages").update({ feature_custom_roles: true }).eq("key", "trial");
    }
  });
});
