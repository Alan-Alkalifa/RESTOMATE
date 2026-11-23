// The real server client and the real deadline guard, with only the network and Next stubbed:
// proves an Auth outage ends fast and reads "unavailable", never "signed out".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const REF = "abcdefgh";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
// An EXPIRED session: reading it makes supabase-js call Auth to refresh it.
const expired = JSON.stringify({
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "11111111-1111-4111-8111-111111111111", exp: 1, aud: "authenticated", role: "authenticated" })}.sig`,
  refresh_token: "refresh-token-not-real",
  expires_in: 3600,
  expires_at: 1,
  token_type: "bearer",
  user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated" },
});
let cookieValue: string | null = expired;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => (cookieValue ? [{ name: `sb-${REF}-auth-token`, value: cookieValue }] : []),
    set: () => {},
  }),
}));

import { SUPABASE_DEADLINE_MS as DEADLINE_FOR_TESTS } from "../supabase/fetch";
import {
  getOrgContext,
  requirePlatformAdmin,
  requireUser,
  AuthUnavailableError,
  getCurrentUser,
} from "./index";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${REF}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-not-real");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-not-real");
  cookieValue = expired;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const never = () => new Promise<Response>(() => {});

describe("an Auth outage with an expired session cookie", () => {
  it("getOrgContext answers 'unavailable' within the deadline when Auth never answers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(never);
    vi.stubGlobal("fetch", fetchMock);
    let done = false;
    const pending = getOrgContext({ slug: "demo" }).then((r) => ((done = true), r));

    await vi.advanceTimersByTimeAsync(DEADLINE_FOR_TESTS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, reason: "unavailable" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("requirePlatformAdmin fails closed with 'unavailable' within the deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(never));
    const pending = requirePlatformAdmin();
    await vi.advanceTimersByTimeAsync(DEADLINE_FOR_TESTS);
    expect(await pending).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("answers at once when the network fails, without waiting out supabase-js's back-off", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", fetchMock);
    let done = false;
    const pending = getOrgContext({ slug: "demo" }).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(await pending).toEqual({ ok: false, reason: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const admin = requirePlatformAdmin();
    await vi.advanceTimersByTimeAsync(0);
    expect(await admin).toEqual({ ok: false, error: { code: "unavailable" } });
    await vi.advanceTimersByTimeAsync(60_000); // the queued retries run out and change nothing
  });

  it("getCurrentUser is 'unavailable', never null, and requireUser does not redirect", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const user = getCurrentUser();
    await vi.advanceTimersByTimeAsync(0);
    expect(await user).toBe("unavailable");

    const required = requireUser({ next: "/app" });
    const assertion = expect(required).rejects.toBeInstanceOf(AuthUnavailableError);
    await vi.advanceTimersByTimeAsync(0);
    await assertion;
  });
});

describe("a missing or invalid session is still signed out, not an outage", () => {
  it("no cookie: null, unauthenticated, and no network call", async () => {
    cookieValue = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCurrentUser()).toBeNull();
    expect(await getOrgContext({ slug: "demo" })).toEqual({ ok: false, reason: "unauthenticated" });
    expect(await requirePlatformAdmin()).toEqual({ ok: false, error: { code: "unauthenticated" } });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(requireUser({ next: "/app/x" })).rejects.toMatchObject({
      url: "/login?next=%2Fapp%2Fx",
    });
  });

  it("Auth answers that the refresh token is dead: null, so the user is sent to log in", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            code: 400,
            error_code: "refresh_token_not_found",
            msg: "Invalid Refresh Token",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    expect(await getCurrentUser()).toBeNull();
    expect(await getOrgContext({ slug: "demo" })).toEqual({ ok: false, reason: "unauthenticated" });
  });
});
