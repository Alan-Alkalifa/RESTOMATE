import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

// ---- the world: order of calls, what Auth answers, who is signed in ---------------------------
const world = {
  order: [] as string[],
  protect: { allowed: true } as
    { allowed: true } | { allowed: false; reason: "rate_limited" | "email_rejected" | "blocked" },
  signedIn: null as null | "unavailable" | { id: string; email: string | null },
  auth: {} as Record<string, () => Promise<unknown> | unknown>,
  calls: [] as { name: string; args: unknown }[],
  cookies: [{ name: "sb-ref-auth-token" }, { name: "sb-ref-auth-token.0" }, { name: "theme" }],
  deleted: [] as string[],
  protectArgs: [] as { preset: string; input: unknown }[],
  clients: [] as string[],
};

vi.mock("../../arcjet/auth", () => ({
  protectAuth: async (preset: string, input: unknown) => {
    world.order.push("protect");
    world.protectArgs.push({ preset, input });
    return world.protect;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => world.cookies,
    delete: (name: string) => world.deleted.push(name),
  }),
}));
vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => {
    world.order.push("user");
    return world.signedIn;
  },
}));

const authCall =
  (name: string, client = "cookies") =>
  async (args: unknown) => {
    world.order.push(`supabase:${name}`);
    world.calls.push({ name, args });
    world.clients.push(`${name}:${client}`);
    const handler = world.auth[name];
    return handler ? handler() : { data: {}, error: null };
  };
const fakeAuth = (client: string) => ({
  auth: {
    signUp: authCall("signUp", client),
    resetPasswordForEmail: authCall("resetPasswordForEmail", client),
  },
});
vi.mock("../../supabase/stateless", () => ({
  createStatelessAuthClient: () => fakeAuth("stateless"),
}));
vi.mock("../../supabase/server", () => ({
  createClient: async () => ({
    auth: {
      setSession: authCall("setSession"),
      signInWithPassword: authCall("signInWithPassword"),
      signUp: authCall("signUp"),
      resetPasswordForEmail: authCall("resetPasswordForEmail"),
      updateUser: authCall("updateUser"),
      signOut: authCall("signOut"),
      verifyOtp: authCall("verifyOtp"),
    },
  }),
}));

import { UNAVAILABLE } from "../../auth";
import { login, requestPasswordReset, resetPassword, signOut, signup } from "./actions";

const redirected = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { message: string; url: string }) =>
      e.message === "NEXT_REDIRECT" ? e.url : Promise.reject(e),
  );
const authError = (code: string, status = 400) => ({
  data: {},
  error: { code, status, name: "AuthApiError" },
});
const supabaseCalls = () => world.calls.map((c) => c.name);

beforeEach(() => {
  Object.assign(world, {
    order: [],
    protect: { allowed: true },
    signedIn: null,
    auth: {},
    calls: [],
    deleted: [],
    protectArgs: [],
    clients: [],
  });
});

const good = { email: "Owner@Example.com ", password: "correct horse battery" };

describe("login", () => {
  it("validates first: a blank, missing or non-string email never reaches Arcjet or Supabase", async () => {
    for (const email of ["", "   ", undefined, 42, ["a@b.co"], { a: 1 }]) {
      const r = await login({ email, password: "x" });
      expect(r).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    expect(world.protectArgs).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  it("returns message keys per field, never the typed value or library text", async () => {
    const r = await login({ email: "not-an-email-but-secret-value", password: "" });
    expect(r).toEqual({
      ok: false,
      error: {
        code: "validation",
        fieldErrors: { email: ["auth.email.invalid"], password: ["auth.field.required"] },
      },
    });
    expect(JSON.stringify(r)).not.toContain("secret-value");
  });

  it("is rate-limited before Supabase is asked anything, with the parsed email", async () => {
    await expect(redirected(login(good))).resolves.toBe("/app");
    expect(world.order.indexOf("protect")).toBeLessThan(
      world.order.indexOf("supabase:signInWithPassword"),
    );
    expect(world.protectArgs).toEqual([{ preset: "login", input: { email: "owner@example.com" } }]);
  });

  it.each([
    ["rate_limited", "rate_limited"],
    ["blocked", "forbidden"],
  ] as const)("maps Arcjet's %s to %s and stops", async (reason, code) => {
    world.protect = { allowed: false, reason };
    expect(await login(good)).toEqual({ ok: false, error: { code } });
    expect(world.calls).toEqual([]);
    expect(world.order).toEqual(["protect"]);
  });

  it("does not tell a wrong password from an unknown email", async () => {
    world.auth.signInWithPassword = () => authError("invalid_credentials");
    expect(await login(good)).toEqual({ ok: false, error: { code: "invalid_credentials" } });
  });

  it("reports an unconfirmed address, and an outage as unavailable (never as a wrong password)", async () => {
    world.auth.signInWithPassword = () => authError("email_not_confirmed");
    expect(await login(good)).toEqual({ ok: false, error: { code: "email_not_confirmed" } });
    world.auth.signInWithPassword = () => ({
      data: {},
      error: { name: "AuthRetryableFetchError", status: 0 },
    });
    expect(await login(good)).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("redirects to a same-site `next` and never off the site", async () => {
    await expect(redirected(login({ ...good, next: "/app/orders?tab=open" }))).resolves.toBe(
      "/app/orders?tab=open",
    );
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/%2F%2Fevil.example",
    ]) {
      await expect(redirected(login({ ...good, next }))).resolves.toBe("/app");
    }
  });

  it("sends a signed-in user on without asking Auth to sign in again", async () => {
    world.signedIn = { id: "u1", email: "owner@example.com" };
    await expect(redirected(login({ ...good, next: "/app/menu" }))).resolves.toBe("/app/menu");
    expect(supabaseCalls()).toEqual([]);
  });

  it("still tries to sign in when Auth is unreachable for the 'already signed in' check", async () => {
    world.signedIn = UNAVAILABLE;
    await expect(redirected(login(good))).resolves.toBe("/app");
    expect(supabaseCalls()).toEqual(["signInWithPassword"]);
  });

  it("reads a FormData too", async () => {
    const fd = new FormData();
    fd.set("email", "owner@example.com");
    fd.set("password", "pw");
    await expect(redirected(login(fd))).resolves.toBe("/app");
  });
});

describe("signup", () => {
  const input = {
    email: "new@example.com",
    password: "longenough1",
    fullName: "  Dewi  ",
    locale: "id",
  };

  it("rejects a short or too long password and a blank email before Arcjet", async () => {
    expect(await signup({ ...input, password: "short" })).toMatchObject({
      error: { fieldErrors: { password: ["auth.password.too_short"] } },
    });
    expect(await signup({ ...input, password: "é".repeat(40) })).toMatchObject({
      error: { fieldErrors: { password: ["auth.password.too_long"] } },
    });
    expect(await signup({ ...input, email: " " })).toMatchObject({ error: { code: "validation" } });
    expect(world.protectArgs).toEqual([]);
  });

  it("passes the name and locale for the profile and sets no redirect host", async () => {
    expect(await signup(input)).toEqual({ ok: true, data: { status: "confirmation_sent" } });
    expect(world.calls[0]).toEqual({
      name: "signUp",
      args: {
        email: "new@example.com",
        password: "longenough1",
        options: { data: { full_name: "Dewi", locale: "id" } },
      },
    });
    expect(world.protectArgs[0]).toEqual({ preset: "signup", input: { email: "new@example.com" } });
    expect(world.order.indexOf("protect")).toBeLessThan(world.order.indexOf("supabase:signUp"));
  });

  it("answers the same for an address that already has an account", async () => {
    world.auth.signUp = () => ({ data: { user: { identities: [] }, session: null }, error: null });
    expect(await signup(input)).toEqual({ ok: true, data: { status: "confirmation_sent" } });
  });

  it.each(["user_already_exists", "email_exists"])(
    "answers exactly as for a new address when the confirmed account exists (%s)",
    async (code) => {
      const fresh = await signup(input);
      world.auth.signUp = () => authError(code, 422);
      const existing = await signup(input);
      expect(existing).toEqual({ ok: true, data: { status: "confirmation_sent" } });
      expect(JSON.stringify(existing)).toBe(JSON.stringify(fresh)); // byte for byte the same
    },
  );

  it("maps Arcjet's email refusal (disposable address) to a validation key", async () => {
    world.protect = { allowed: false, reason: "email_rejected" };
    expect(await signup(input)).toEqual({
      ok: false,
      error: { code: "validation", fieldErrors: { email: ["auth.email.rejected"] } },
    });
    expect(world.calls).toEqual([]);
  });

  it("maps Auth's weak password and rate limit", async () => {
    world.auth.signUp = () => authError("weak_password");
    expect(await signup(input)).toMatchObject({
      error: { fieldErrors: { password: ["auth.password.weak"] } },
    });
    world.auth.signUp = () => authError("over_email_send_rate_limit", 429);
    expect(await signup(input)).toEqual({ ok: false, error: { code: "rate_limited" } });
  });

  it("signs in at once when the project does not need confirmation", async () => {
    world.auth.signUp = () => ({
      data: { session: { access_token: "a", refresh_token: "r" } },
      error: null,
    });
    await expect(redirected(signup({ ...input, next: "/app/start" }))).resolves.toBe("/app/start");
    expect(world.calls[1]).toEqual({
      name: "setSession",
      args: { access_token: "a", refresh_token: "r" },
    });
  });

  it("signup and the reset request use the cookie-free client; nothing else does", async () => {
    await signup(input);
    await requestPasswordReset({ email: "a@b.co" });
    world.signedIn = { id: "u1", email: null };
    await redirected(
      resetPassword({ password: "a-new-password", confirmPassword: "a-new-password" }),
    );
    expect(world.clients).toEqual([
      "signUp:stateless",
      "resetPasswordForEmail:stateless",
      "updateUser:cookies",
      "signOut:cookies",
    ]);
  });
});

describe("requestPasswordReset", () => {
  it("validates, rate-limits, then asks Auth, and says ok", async () => {
    expect(await requestPasswordReset({ email: "A@B.co" })).toEqual({ ok: true, data: undefined });
    expect(world.protectArgs).toEqual([{ preset: "passwordReset", input: { email: "a@b.co" } }]);
    expect(world.order.indexOf("protect")).toBeLessThan(
      world.order.indexOf("supabase:resetPasswordForEmail"),
    );
    expect(await requestPasswordReset({ email: "" })).toMatchObject({
      error: { code: "validation" },
    });
  });

  it("looks the same for an unknown address or any other Auth error", async () => {
    world.auth.resetPasswordForEmail = () => authError("user_not_found", 404);
    expect(await requestPasswordReset({ email: "nobody@example.com" })).toEqual({
      ok: true,
      data: undefined,
    });
  });

  it("reports only a rate limit or an outage", async () => {
    world.auth.resetPasswordForEmail = () => authError("over_email_send_rate_limit", 429);
    expect(await requestPasswordReset({ email: "a@b.co" })).toEqual({
      ok: false,
      error: { code: "rate_limited" },
    });
    world.auth.resetPasswordForEmail = () => ({
      data: {},
      error: { name: "AuthRetryableFetchError", status: 503 },
    });
    expect(await requestPasswordReset({ email: "a@b.co" })).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });
});

describe("resetPassword", () => {
  const next = { password: "a-new-password", confirmPassword: "a-new-password" };

  it("needs matching passwords", async () => {
    expect(await resetPassword({ ...next, confirmPassword: "other-password" })).toMatchObject({
      error: { fieldErrors: { confirmPassword: ["auth.password.mismatch"] } },
    });
  });

  it("is rate-limited before the session is even read", async () => {
    world.protect = { allowed: false, reason: "rate_limited" };
    expect(await resetPassword(next)).toEqual({ ok: false, error: { code: "rate_limited" } });
    expect(world.order).toEqual(["protect"]);
  });

  it("needs a session, from the recovery link", async () => {
    expect(await resetPassword(next)).toEqual({ ok: false, error: { code: "unauthenticated" } });
    world.signedIn = UNAVAILABLE;
    expect(await resetPassword(next)).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(world.calls).toEqual([]);
  });

  it("updates the password, ends the other sessions and moves on", async () => {
    world.signedIn = { id: "u1", email: "owner@example.com" };
    await expect(redirected(resetPassword(next))).resolves.toBe("/app");
    expect(world.calls).toEqual([
      { name: "updateUser", args: { password: "a-new-password" } },
      { name: "signOut", args: { scope: "others" } },
    ]);
    expect(world.order.indexOf("protect")).toBeLessThan(world.order.indexOf("supabase:updateUser"));
  });

  it("maps the same password", async () => {
    world.signedIn = { id: "u1", email: null };
    world.auth.updateUser = () => authError("same_password", 422);
    expect(await resetPassword(next)).toMatchObject({
      error: { fieldErrors: { password: ["auth.password.same_as_old"] } },
    });
  });
});

describe("signOut", () => {
  it("revokes this session only, clears the Supabase cookies and redirects", async () => {
    await expect(redirected(signOut())).resolves.toBe("/login");
    expect(world.calls).toEqual([{ name: "signOut", args: { scope: "local" } }]);
    expect(world.deleted).toEqual(["sb-ref-auth-token", "sb-ref-auth-token.0"]);
  });

  it("still clears the cookies when Auth cannot be reached", async () => {
    world.auth.signOut = () => Promise.reject(new TypeError("fetch failed"));
    await expect(redirected(signOut())).resolves.toBe("/login");
    expect(world.deleted).toHaveLength(2);
  });

  it.each(["rate_limited", "blocked"] as const)(
    "is never refused: with Arcjet answering %s it still signs out and redirects",
    async (reason) => {
      world.protect = { allowed: false, reason };
      await expect(redirected(signOut())).resolves.toBe("/login");
      expect(world.protectArgs).toEqual([]);
      expect(world.calls).toEqual([{ name: "signOut", args: { scope: "local" } }]);
      expect(world.deleted).toEqual(["sb-ref-auth-token", "sb-ref-auth-token.0"]);
    },
  );
});
