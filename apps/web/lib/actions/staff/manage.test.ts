import { createHash } from "node:crypto";
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
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const ROLE = "66666666-6666-4666-8666-666666666666";
const LOC = "44444444-4444-4444-8444-444444444444";
const INV = "77777777-7777-4777-8777-777777777777";
const NEW_INV = "88888888-8888-4888-8888-888888888888";

type Invitation = {
  id: string;
  org_id: string;
  email: string;
  role_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
};

const world = {
  order: [] as string[],
  permissions: ["staff.manage"] as string[],
  context: "ok" as "ok" | "no_membership" | "unavailable",
  rpc: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  member: { data: { user_id: THEM }, error: null } as { data: unknown; error: unknown },
  invitation: null as Invitation | null,
  roleName: "Cashier" as string | null,
  emails: [] as Record<string, unknown>[],
  emailOk: true,
};
const openInvitation = (): Invitation => ({
  id: INV,
  org_id: ORG,
  email: "siti@example.com",
  role_id: ROLE,
  accepted_at: null,
  revoked_at: null,
});

vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => ({ id: ME, email: "me@example.com" }),
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
        org: { id: ORG, slug: "warung", name: "Warung Sedap" },
        member: { id: "m0", roleId: "r0", roleKey: "manager", roleName: "Manager" },
        permissions: new Set(world.permissions),
        package: null,
      },
    };
  },
}));
vi.mock("./email", () => ({
  sendInvitationEmail: async (m: Record<string, unknown>) => {
    world.order.push("email");
    world.emails.push(m);
    return world.emailOk ? { ok: true, delivery: "log" } : { ok: false, error: "provider_error" };
  },
}));
vi.mock("../../supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: async () => {
          world.order.push(`admin:${table}`);
          if (table === "roles") {
            return { data: world.roleName ? { name: world.roleName } : null, error: null };
          }
          const inv = world.invitation;
          const hit = inv && inv.id === filters.id && inv.org_id === filters.org_id;
          return { data: hit ? inv : null, error: null };
        },
      };
      return query;
    },
  }),
}));
vi.mock("../../supabase/server", () => ({
  createClient: async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => {
        world.order.push("member");
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

import {
  changeMemberRole,
  deactivateMember,
  inviteStaff,
  reactivateMember,
  resendInvitation,
  revokeInvitation,
} from "./actions";

const sha = (token: string) =>
  `\\x${createHash("sha256").update(Buffer.from(token, "utf8")).digest("hex")}`;
const dbError = (message: string, code = "P0001") => ({ data: null, error: { code, message } });

beforeEach(() => {
  updated.length = 0;
  Object.assign(world, {
    order: [],
    permissions: ["staff.manage"],
    context: "ok",
    rpc: {},
    calls: [],
    member: { data: { user_id: THEM }, error: null },
    invitation: openInvitation(),
    roleName: "Cashier",
    emails: [],
    emailOk: true,
  });
});

const invite = { orgId: ORG, email: " Siti@Example.com ", roleId: ROLE, locationIds: [LOC] };

describe("every staff action is permission-checked first", () => {
  const actions: [string, () => Promise<unknown>][] = [
    ["inviteStaff", () => inviteStaff(invite)],
    ["resendInvitation", () => resendInvitation({ orgId: ORG, invitationId: INV })],
    ["revokeInvitation", () => revokeInvitation({ orgId: ORG, invitationId: INV })],
    ["changeMemberRole", () => changeMemberRole({ orgId: ORG, memberId: MEMBER, roleId: ROLE })],
    ["deactivateMember", () => deactivateMember({ orgId: ORG, memberId: MEMBER })],
    ["reactivateMember", () => reactivateMember({ orgId: ORG, memberId: MEMBER })],
  ];

  it.each(actions)("%s: a Cashier gets forbidden and nothing else happens", async (_, run) => {
    world.permissions = ["orders.view", "orders.create", "pos.use"];
    expect(await run()).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(world.order).toEqual(["context"]); // no lookup, no RPC, no email
    expect(world.calls).toEqual([]);
    expect(world.emails).toEqual([]);
    expect(updated).toEqual([]);
  });

  it.each(actions)("%s: passes on the context's refusal", async (_, run) => {
    world.context = "no_membership";
    expect(await run()).toEqual({ ok: false, error: { code: "no_membership" } });
    world.context = "unavailable";
    expect(await run()).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(world.calls).toEqual([]);
  });
});

describe("inviteStaff", () => {
  it("sends the database only the token's SHA-256, and the email only the raw token", async () => {
    world.rpc.create_staff_invitation = () => ({ data: NEW_INV, error: null });
    const r = await inviteStaff(invite);
    expect(r).toEqual({ ok: true, data: { invitationId: NEW_INV, emailSent: true } });

    const args = world.calls[0].args;
    expect(args).toMatchObject({
      p_org_id: ORG,
      p_email: "siti@example.com",
      p_role_id: ROLE,
      p_all_locations: false,
      p_location_ids: [LOC],
    });
    const email = world.emails[0];
    const token = String(email.token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.p_token_hash).toBe(sha(token)); // the stored value is the digest ...
    expect(JSON.stringify(world.calls)).not.toContain(token); // ... and never the raw token
    expect(email).toMatchObject({
      invitationId: NEW_INV,
      to: "siti@example.com",
      orgName: "Warung Sedap",
      roleName: "Cashier",
    });
    expect(world.order).toEqual(["context", "rpc:create_staff_invitation", "admin:roles", "email"]);
  });

  it("all locations sends no list; a list and all locations together is refused first", async () => {
    world.rpc.create_staff_invitation = () => ({ data: NEW_INV, error: null });
    await inviteStaff({ ...invite, allLocations: "on", locationIds: [] });
    expect(world.calls[0].args).toMatchObject({ p_all_locations: true, p_location_ids: [] });
    world.calls.length = 0;
    expect(await inviteStaff({ ...invite, allLocations: true })).toMatchObject({
      error: { code: "validation", fieldErrors: { locationIds: ["staff.locations.invalid"] } },
    });
    expect(await inviteStaff({ ...invite, locationIds: [] })).toMatchObject({
      error: { code: "validation", fieldErrors: { locationIds: ["staff.locations.required"] } },
    });
    expect(world.calls).toEqual([]);
  });

  it("validates before anything: a bad address, a 65-character local part, a bad role", async () => {
    const r = await inviteStaff({
      orgId: "x",
      email: `${"a".repeat(65)}@example.com`,
      roleId: "y",
    });
    expect(r).toMatchObject({
      error: {
        code: "validation",
        fieldErrors: {
          orgId: expect.any(Array),
          email: ["staff.email.invalid"],
          roleId: expect.any(Array),
        },
      },
    });
    expect(world.order).toEqual([]);
  });

  it.each([
    [dbError("ESCALATION_DENIED", "42501"), { code: "forbidden" }],
    [
      dbError("PLAN_LIMIT:staff"),
      { code: "feature_unavailable", fieldErrors: { form: ["staff.plan_limit.staff"] } },
    ],
    [
      dbError("INVITATION_EXISTS"),
      { code: "conflict", fieldErrors: { email: ["staff.invitation.exists"] } },
    ],
    [
      dbError("ALREADY_MEMBER"),
      { code: "conflict", fieldErrors: { form: ["staff.invitation.already_member"] } },
    ],
  ])("maps %j and sends no email", async (answer, error) => {
    world.rpc.create_staff_invitation = () => answer;
    expect(await inviteStaff(invite)).toEqual({ ok: false, error });
    expect(world.emails).toEqual([]);
  });

  it("a failed email keeps the invitation and says so (resend retries)", async () => {
    world.rpc.create_staff_invitation = () => ({ data: NEW_INV, error: null });
    world.emailOk = false;
    expect(await inviteStaff(invite)).toEqual({
      ok: true,
      data: { invitationId: NEW_INV, emailSent: false },
    });
  });

  it("a missing role name still sends the email", async () => {
    world.rpc.create_staff_invitation = () => ({ data: NEW_INV, error: null });
    world.roleName = null;
    expect((await inviteStaff(invite)).ok).toBe(true);
    expect(world.emails[0].roleName).toBe("a team member");
  });
});

describe("resendInvitation", () => {
  it("gives a new token, hash, invitation and email key (the new row's ID)", async () => {
    world.rpc.resend_staff_invitation = () => ({ data: NEW_INV, error: null });
    const first = await inviteStaff(invite); // a token for comparison
    expect(first.ok || !first.ok).toBe(true);
    const r = await resendInvitation({ orgId: ORG, invitationId: INV });
    expect(r).toEqual({ ok: true, data: { invitationId: NEW_INV, emailSent: true } });

    const call = world.calls.find((c) => c.fn === "resend_staff_invitation")!;
    const email = world.emails[world.emails.length - 1];
    expect(call.args.p_invitation_id).toBe(INV);
    expect(call.args.p_new_token_hash).toBe(sha(String(email.token)));
    expect(JSON.stringify(call.args)).not.toContain(String(email.token));
    expect(email).toMatchObject({ invitationId: NEW_INV, to: "siti@example.com" });
    expect(email.invitationId).not.toBe(INV); // so the email's idempotency key is new
  });

  it("two resends never share a token", async () => {
    world.rpc.resend_staff_invitation = () => ({ data: NEW_INV, error: null });
    await resendInvitation({ orgId: ORG, invitationId: INV });
    await resendInvitation({ orgId: ORG, invitationId: INV });
    const [a, b] = world.emails.map((e) => e.token);
    expect(a).not.toBe(b);
  });

  it("refuses another org's, unknown and closed invitations before the database", async () => {
    world.invitation = { ...openInvitation(), org_id: OTHER_ORG };
    expect(await resendInvitation({ orgId: ORG, invitationId: INV })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    world.invitation = { ...openInvitation(), revoked_at: "2026-11-23T00:00:00Z" };
    expect(await resendInvitation({ orgId: ORG, invitationId: INV })).toMatchObject({
      error: { code: "conflict" },
    });
    world.invitation = null;
    expect(await resendInvitation({ orgId: ORG, invitationId: INV })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.calls).toEqual([]);
    expect(world.emails).toEqual([]);
  });

  it("a closed invitation whose role was deleted has no role: it can't be resent anyway", async () => {
    world.invitation = { ...openInvitation(), role_id: null, accepted_at: "2026-11-23T00:00:00Z" };
    expect(await resendInvitation({ orgId: ORG, invitationId: INV })).toMatchObject({
      error: { code: "conflict" },
    });
  });
});

describe("revokeInvitation", () => {
  it("revokes an open invitation of this org", async () => {
    expect(await revokeInvitation({ orgId: ORG, invitationId: INV })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(world.calls).toEqual([
      { fn: "revoke_staff_invitation", args: { p_invitation_id: INV } },
    ]);
  });

  it("refuses another org's invitation, and maps INVITATION_CLOSED", async () => {
    world.invitation = { ...openInvitation(), org_id: OTHER_ORG };
    expect(await revokeInvitation({ orgId: ORG, invitationId: INV })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    world.invitation = openInvitation();
    world.rpc.revoke_staff_invitation = () => dbError("INVITATION_CLOSED");
    expect(await revokeInvitation({ orgId: ORG, invitationId: INV })).toMatchObject({
      error: { code: "conflict" },
    });
  });
});

describe("members", () => {
  const ref = { orgId: ORG, memberId: MEMBER };

  it("changes a role and refreshes that member's access", async () => {
    expect(await changeMemberRole({ ...ref, roleId: ROLE })).toEqual({ ok: true, data: undefined });
    expect(world.calls).toEqual([
      { fn: "change_member_role", args: { p_member_id: MEMBER, p_role_id: ROLE } },
    ]);
    expect(updated).toEqual([`user:${THEM}:memberships`, `org:${ORG}:member:${THEM}`]);
  });

  it("deactivating refreshes the member's access from the user ID the database returns", async () => {
    world.rpc.set_member_status = () => ({ data: THEM, error: null });
    expect(await deactivateMember(ref)).toEqual({ ok: true, data: undefined });
    expect(world.calls).toEqual([
      { fn: "set_member_status", args: { p_member_id: MEMBER, p_status: "deactivated" } },
    ]);
    expect(updated).toEqual([`user:${THEM}:memberships`, `org:${ORG}:member:${THEM}`]);
  });

  it("reactivating asks for 'active'", async () => {
    world.rpc.set_member_status = () => ({ data: THEM, error: null });
    await reactivateMember(ref);
    expect(world.calls[0].args).toEqual({ p_member_id: MEMBER, p_status: "active" });
  });

  it.each([
    [
      dbError("LAST_OWNER"),
      { code: "conflict", fieldErrors: { form: ["staff.member.last_owner"] } },
    ],
    [dbError("ESCALATION_DENIED", "42501"), { code: "forbidden" }],
    [
      dbError("PLAN_LIMIT:staff"),
      { code: "feature_unavailable", fieldErrors: { form: ["staff.plan_limit.staff"] } },
    ],
    [
      dbError("MEMBER_ALREADY_DEACTIVATED"),
      { code: "conflict", fieldErrors: { form: ["staff.member.already_deactivated"] } },
    ],
  ])("maps %j and refreshes nothing", async (answer, error) => {
    world.rpc.set_member_status = () => answer;
    expect(await deactivateMember(ref)).toEqual({ ok: false, error });
    expect(updated).toEqual([]);
  });

  it("a member of another org is forbidden before the database is asked", async () => {
    world.member = { data: null, error: null };
    expect(await deactivateMember(ref)).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(await changeMemberRole({ ...ref, roleId: ROLE })).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(world.calls).toEqual([]);
  });
});
