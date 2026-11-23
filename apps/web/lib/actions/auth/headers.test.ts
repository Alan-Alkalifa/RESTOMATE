// QA S3 on #42: the response HEADERS must not tell an existing account from a new one. The real
// supabase-js and @supabase/ssr clients run here; only GoTrue (fetch) and Next are faked. Every
// cookie the action writes or clears is recorded: for signup and the reset request they must be
// identical whatever the address.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

type Write = { op: "set" | "delete"; name: string; value?: string; options?: unknown };
const writes: Write[] = [];
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => [],
    set: (name: string, value: string, options?: unknown) =>
      writes.push({ op: "set", name, value, options }),
    delete: (name: string) => writes.push({ op: "delete", name }),
  }),
}));
vi.mock("../../arcjet/auth", () => ({ protectAuth: async () => ({ allowed: true }) }));
vi.mock("../../auth/user", async (original) => ({
  ...(await original<typeof import("../../auth/user")>()),
  getCurrentUser: async () => null,
}));

import { createClient } from "../../supabase/server";
import { requestPasswordReset, resendConfirmation, signup } from "./actions";

const REF = "abcdefgh";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const user = (identities: unknown[]) => ({
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "someone@example.com",
  identities,
  created_at: "2026-11-23T00:00:00Z",
});

/** What GoTrue answers to a signup, by case (no session: email confirmation is on). */
const SIGNUP = {
  new: () => json(user([{ id: "i1", provider: "email" }])),
  unconfirmed: () => json(user([])), // GoTrue's obfuscated answer for a pending address
  existing: () =>
    json({ code: 422, error_code: "user_already_exists", msg: "User already registered" }, 422),
};

let bodies: string[] = [];
const answer = (respond: () => Response) =>
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    return respond();
  });

beforeEach(() => {
  writes.length = 0;
  bodies = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${REF}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-not-real");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = { email: "someone@example.com", password: "longenough1" };

async function run(action: () => Promise<unknown>, respond: () => Response) {
  writes.length = 0;
  bodies = [];
  answer(respond);
  const result = await action();
  return { result, writes: [...writes], bodies: [...bodies] };
}

describe("signup: same result and same cookies for every kind of address", () => {
  it("new, unconfirmed and existing-confirmed are indistinguishable", async () => {
    const outcomes = {
      new: await run(() => signup(form), SIGNUP.new),
      unconfirmed: await run(() => signup(form), SIGNUP.unconfirmed),
      existing: await run(() => signup(form), SIGNUP.existing),
    };
    for (const o of Object.values(outcomes)) {
      expect(o.result).toEqual({ ok: true, data: { status: "confirmation_sent" } });
      expect(o.writes).toEqual([]); // no Set-Cookie at all: nothing to compare against
    }
    expect(outcomes.existing.writes).toEqual(outcomes.new.writes);
    expect(outcomes.unconfirmed.writes).toEqual(outcomes.new.writes);
  });

  it("asks GoTrue with no PKCE challenge (the email link uses token_hash)", async () => {
    const { bodies } = await run(() => signup(form), SIGNUP.new);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0])).toMatchObject({
      code_challenge: null,
      code_challenge_method: null,
    });
  });
});

describe("password-reset request: same result and same cookies for a known and an unknown address", () => {
  it("known and unknown are indistinguishable", async () => {
    const known = await run(
      () => requestPasswordReset({ email: "someone@example.com" }),
      () => json({}),
    );
    const unknown = await run(
      () => requestPasswordReset({ email: "nobody@example.com" }),
      () => json({}),
    );
    expect(known.result).toEqual({ ok: true, data: undefined });
    expect(unknown.result).toEqual(known.result);
    expect(known.writes).toEqual([]);
    expect(unknown.writes).toEqual(known.writes);
    expect(JSON.parse(known.bodies[0])).toMatchObject({ code_challenge: null });
  });
});

describe("control: the @supabase/ssr (PKCE) client shows the leak this fixes", () => {
  it("sets a code-verifier cookie for a new address and clears it for an existing one", async () => {
    const viaSsr = async (respond: () => Response) => {
      writes.length = 0;
      answer(respond);
      await (await createClient()).auth.signUp(form);
      return writes.map((w) => `${w.op}:${w.name}:${w.value === "" ? "empty" : "value"}`);
    };
    const fresh = await viaSsr(SIGNUP.new);
    const existing = await viaSsr(SIGNUP.existing);
    expect(fresh.some((w) => w.includes("code-verifier"))).toBe(true);
    expect(existing).not.toEqual(fresh);
  });
});

describe("resend confirmation: same result and no cookie for every kind of address", () => {
  it("unknown, unconfirmed and confirmed are indistinguishable", async () => {
    const answers = {
      unknown: () => json({ message: "User not found" }, 404),
      unconfirmed: () => json({}),
      confirmed: () =>
        json({ code: 422, error_code: "email_exists", msg: "already confirmed" }, 422),
    };
    const out = {
      unknown: await run(
        () => resendConfirmation({ email: "someone@example.com" }),
        answers.unknown,
      ),
      unconfirmed: await run(
        () => resendConfirmation({ email: "someone@example.com" }),
        answers.unconfirmed,
      ),
      confirmed: await run(
        () => resendConfirmation({ email: "someone@example.com" }),
        answers.confirmed,
      ),
    };
    for (const o of Object.values(out)) {
      expect(o.result).toEqual({ ok: true, data: undefined });
      expect(o.writes).toEqual([]); // no Set-Cookie at all
      expect(JSON.parse(o.bodies[0])).toMatchObject({ type: "signup" });
    }
    expect(out.confirmed.result).toEqual(out.unknown.result);
    expect(out.confirmed.writes).toEqual(out.unconfirmed.writes);
  });
});
