// S3 (DAVIN, #39): a valid token whose signing keys cannot be fetched (cold JWKS cache on a new
// instance while Auth is down) is an outage, not "signed out". Only a bad token is "no session".
// Real client, real deadline guard and real WebCrypto; only the network and Next are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const REF = "abcdefgh";
const USER = "11111111-1111-4111-8111-111111111111";
// auth-js caches signing keys per project, across clients: every test publishes its own key ID.
let keySeq = 0;
let KID = "";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

const incoming = new Headers();
let cookieValue: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({
    getAll: () => (cookieValue ? [{ name: `sb-${REF}-auth-token`, value: cookieValue }] : []),
    set: () => {},
  }),
}));

import { getCurrentUser } from "./index";

async function keyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
}

async function signedToken(privateKey: CryptoKey, claims: object = {}) {
  const header = b64({ alg: "ES256", typ: "JWT", kid: KID });
  const payload = b64({
    sub: USER,
    email: "owner@example.com",
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(sig).toString("base64url")}`;
}

const session = (accessToken: string) =>
  JSON.stringify({
    access_token: accessToken,
    refresh_token: "refresh-token-not-real",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: USER, aud: "authenticated" },
  });

const jwks = async (publicKey: CryptoKey) => ({
  keys: [
    { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: KID, alg: "ES256", use: "sig" },
  ],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${REF}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-not-real");
  incoming.delete("x-restomate-auth-down");
  KID = `test-key-${++keySeq}`;
  cookieValue = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a valid token while the signing keys cannot be fetched", () => {
  it("is 'unavailable' when the JWKS request fails on the network", async () => {
    const { privateKey } = await keyPair();
    cookieValue = session(await signedToken(privateKey));
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    expect(await getCurrentUser()).toBe("unavailable");
  });

  it.each([502, 503, 504, 500])(
    "is 'unavailable' when the JWKS endpoint answers %i",
    async (status) => {
      const { privateKey } = await keyPair();
      cookieValue = session(await signedToken(privateKey));
      vi.stubGlobal("fetch", async () => json({ message: "down" }, status));
      expect(await getCurrentUser()).toBe("unavailable");
    },
  );

  it("is 'unavailable' when the JWKS endpoint answers a non-JSON page", async () => {
    const { privateKey } = await keyPair();
    cookieValue = session(await signedToken(privateKey));
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 200 }));
    expect(await getCurrentUser()).toBe("unavailable");
  });

  it("is 'unavailable' when the JWKS endpoint never answers, within the deadline", async () => {
    vi.useFakeTimers();
    const { privateKey } = await keyPair();
    cookieValue = session(await signedToken(privateKey));
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const pending = getCurrentUser();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toBe("unavailable");
  });
});

describe("a bad token is still 'no session', never 'unavailable'", () => {
  it("a malformed token", async () => {
    cookieValue = session("not-a-jwt");
    vi.stubGlobal("fetch", vi.fn());
    expect(await getCurrentUser()).toBeNull();
  });

  it("a token signed by a different key than the published one", async () => {
    const real = await keyPair();
    const forger = await keyPair();
    cookieValue = session(await signedToken(forger.privateKey));
    vi.stubGlobal("fetch", async () => json(await jwks(real.publicKey)));
    expect(await getCurrentUser()).toBeNull();
  });

  it("a token whose key ID is not published", async () => {
    const real = await keyPair();
    cookieValue = session(await signedToken(real.privateKey));
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      // Auth knows no such key, and the fallback user lookup rejects the token.
      return url.includes("jwks")
        ? json({ keys: [] })
        : json({ code: 401, msg: "invalid JWT" }, 401);
    });
    expect(await getCurrentUser()).toBeNull();
  });

  it("a validly signed token is the user (the control case)", async () => {
    const real = await keyPair();
    cookieValue = session(await signedToken(real.privateKey));
    vi.stubGlobal("fetch", async () => json(await jwks(real.publicKey)));
    expect(await getCurrentUser()).toEqual({ id: USER, email: "owner@example.com" });
  });
});

describe("the proxy's 'Auth is down' signal (S4)", () => {
  it("answers 'unavailable' at once, with no Auth call, when the proxy's refresh already failed", async () => {
    const real = await keyPair();
    cookieValue = session(await signedToken(real.privateKey));
    incoming.set("x-restomate-auth-down", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCurrentUser()).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without the signal the same request asks Auth as usual", async () => {
    const real = await keyPair();
    cookieValue = session(await signedToken(real.privateKey));
    vi.stubGlobal("fetch", async () => json(await jwks(real.publicKey)));
    expect(await getCurrentUser()).not.toBe("unavailable");
  });
});
