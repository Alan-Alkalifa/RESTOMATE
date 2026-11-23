import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, calls, resetFake, state } from "./fake";

vi.mock("@arcjet/next", async () => (await import("./fake")).fakeModule);

import { resetArcjetForTests } from "../arcjet";
import { AUTH_LIMITS, protectAuth } from "./auth";
import { emailKey, normalizeEmail } from "./hash";

const SECRET = "test-arcjet-key-not-real";
const req = (ip: string): FakeRequest => ({ ip });
const call = (preset: Parameters<typeof protectAuth>[0], ip: string, email?: string) =>
  protectAuth(preset, { email, request: req(ip) as never });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("ARCJET_KEY", SECRET);
  resetFake();
  resetArcjetForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
});

async function attempts(
  preset: Parameters<typeof protectAuth>[0],
  n: number,
  ipOf: (i: number) => string,
  emailOf: (i: number) => string | undefined,
) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await call(preset, ipOf(i), emailOf(i)));
  return out;
}

describe("login", () => {
  it("denies after the per-IP limit, whatever the email", async () => {
    const max = AUTH_LIMITS.login.ip.max;
    const r = await attempts(
      "login",
      max + 1,
      () => "1.1.1.1",
      (i) => `user${i}@example.com`,
    );
    expect(r.slice(0, max).every((x) => x.allowed)).toBe(true);
    expect(r[max]).toEqual({ allowed: false, reason: "rate_limited" });
  });

  it("denies after the per-email limit, from many IPs, and ignores case and spacing", async () => {
    const max = AUTH_LIMITS.login.email.max;
    const variants = ["Dewi@Example.com", " dewi@example.com ", "DEWI@EXAMPLE.COM"];
    const r = await attempts(
      "login",
      max + 1,
      (i) => `2.2.2.${i}`,
      (i) => variants[i % 3],
    );
    expect(r.slice(0, max).every((x) => x.allowed)).toBe(true);
    expect(r[max]).toEqual({ allowed: false, reason: "rate_limited" });
    // Another address is unaffected.
    expect((await call("login", "3.3.3.3", "other@example.com")).allowed).toBe(true);
  });

  it("limits by IP alone when the form has no email", async () => {
    const max = AUTH_LIMITS.login.ip.max;
    const r = await attempts(
      "login",
      max + 1,
      () => "4.4.4.4",
      () => undefined,
    );
    expect(r[max]).toEqual({ allowed: false, reason: "rate_limited" });
  });
});

describe("signup", () => {
  it("denies after the per-IP limit", async () => {
    const max = AUTH_LIMITS.signup.ip.max;
    const r = await attempts(
      "signup",
      max + 1,
      () => "5.5.5.5",
      (i) => `new${i}@example.com`,
    );
    expect(r[max]).toEqual({ allowed: false, reason: "rate_limited" });
  });

  it("denies after the per-email limit", async () => {
    const max = AUTH_LIMITS.signup.email.max;
    const r = await attempts(
      "signup",
      max + 1,
      (i) => `6.6.6.${i}`,
      () => "same@example.com",
    );
    expect(r[max]).toEqual({ allowed: false, reason: "rate_limited" });
  });

  it("refuses a disposable address", async () => {
    expect(await call("signup", "7.7.7.7", "x@mailinator.com")).toEqual({
      allowed: false,
      reason: "email_rejected",
    });
  });

  it("refuses an invalid address", async () => {
    expect(await call("signup", "7.7.7.8", "not-an-email")).toEqual({
      allowed: false,
      reason: "email_rejected",
    });
  });

  it("accepts a real address on an Indonesian domain", async () => {
    expect((await call("signup", "7.7.7.9", "budi@kopi-nusantara.co.id")).allowed).toBe(true);
  });

  it("does not check email on other presets", async () => {
    expect((await call("login", "7.7.7.10", "x@mailinator.com")).allowed).toBe(true);
  });
});

describe.each(["passwordReset", "resendConfirmation"] as const)("%s", (preset) => {
  it("limits per IP and per email", async () => {
    const lim = AUTH_LIMITS[preset];
    const byIp = await attempts(
      preset,
      lim.ip.max + 1,
      () => "8.8.8.8",
      (i) => `a${i}@example.com`,
    );
    expect(byIp[lim.ip.max]).toEqual({ allowed: false, reason: "rate_limited" });
    const byEmail = await attempts(
      preset,
      lim.email.max + 1,
      (i) => `9.9.9.${i}`,
      () => "b@example.com",
    );
    expect(byEmail[lim.email.max]).toEqual({ allowed: false, reason: "rate_limited" });
  });
});

describe("email input", () => {
  const PRESETS = ["login", "signup", "passwordReset", "resendConfirmation"] as const;

  it.each(PRESETS)("%s rejects a non-string email without calling Arcjet", async (preset) => {
    for (const bad of [123, {}, [], ["a@b.co"], null, true]) {
      const r = await protectAuth(preset, {
        email: bad as never,
        request: req("13.0.0.1") as never,
      });
      expect(r).toEqual({ allowed: false, reason: "email_rejected" });
    }
    expect(calls).toHaveLength(0);
  });

  it.each(["", "   ", "\t\n"])(
    "signup rejects a blank email (%j) without calling Arcjet",
    async (blank) => {
      expect(await call("signup", "13.0.0.2", blank)).toEqual({
        allowed: false,
        reason: "email_rejected",
      });
      expect(await call("signup", "13.0.0.2", undefined)).toEqual({
        allowed: false,
        reason: "email_rejected",
      });
      expect(calls).toHaveLength(0);
    },
  );

  it.each(["login", "passwordReset", "resendConfirmation"] as const)(
    "%s with no or blank email is limited by IP only",
    async (preset) => {
      const max = AUTH_LIMITS[preset].ip.max;
      expect((await call(preset, "13.0.0.3", undefined)).allowed).toBe(true);
      expect((await call(preset, "13.0.0.3", "  ")).allowed).toBe(true);
      expect(Object.keys(calls[0].props)).toEqual([]);
      for (let i = 0; i < max; i++) await call(preset, "13.0.0.3", undefined);
      expect(await call(preset, "13.0.0.3", undefined)).toEqual({
        allowed: false,
        reason: "rate_limited",
      });
    },
  );

  it("rejects a bad email even when Arcjet is not configured", async () => {
    vi.stubEnv("ARCJET_KEY", "");
    resetArcjetForTests();
    expect(await call("signup", "13.0.0.4", " ")).toEqual({
      allowed: false,
      reason: "email_rejected",
    });
  });
});

describe("no personal value leaves", () => {
  it("passes a keyed hash, never the address, as the rate-limit key", async () => {
    await call("login", "10.0.0.1", "Secret.Person@Example.com");
    const { props } = calls[0];
    expect(props.emailKey).toMatch(/^[0-9a-f]{64}$/);
    expect(props.emailKey).toBe(await emailKey("login", "secret.person@example.com", SECRET));
    expect(String(props.emailKey)).not.toContain("secret");
  });

  it.each(["login", "passwordReset", "resendConfirmation"] as const)(
    "%s sends no raw email to Arcjet",
    async (preset) => {
      const address = "Private.Person@Example.com";
      await call(preset, "10.0.0.2", address);
      const { props } = calls[0];
      expect(Object.keys(props)).toEqual(["emailKey"]);
      expect(props).not.toHaveProperty("email");
      const values = Object.values(props).map((v) => String(v).toLowerCase());
      expect(values).not.toContain(address.toLowerCase());
      expect(JSON.stringify(props).toLowerCase()).not.toContain("private.person");
    },
  );

  it("signup sends the address, because email validation needs it", async () => {
    await call("signup", "10.0.0.3", "Private.Person@Example.com");
    expect(calls[0].props.email).toBe("private.person@example.com");
  });

  it("keeps one preset's key apart from another's", async () => {
    expect(await emailKey("login", "a@b.co", SECRET)).not.toBe(
      await emailKey("signup", "a@b.co", SECRET),
    );
    expect(normalizeEmail(" A@B.Co ")).toBe("a@b.co");
  });

  it("logs a code and the preset only", async () => {
    for (let i = 0; i < 8; i++) await call("login", "11.0.0.1", "victim.person@example.com");
    state.failure = true;
    await call("login", "11.0.0.2", "victim.person@example.com");
    const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("arcjet_denied_rate_limited");
    expect(logged).toContain("arcjet_error");
    for (const secret of ["victim", "example.com", "11.0.0", SECRET]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("fail open", () => {
  it("allows and logs when ARCJET_KEY is missing", async () => {
    vi.stubEnv("ARCJET_KEY", "");
    resetArcjetForTests();
    expect(await call("login", "12.0.0.1", "a@example.com")).toEqual({ allowed: true });
    expect(warn.mock.calls.join()).toContain("arcjet_unconfigured");
    expect(calls).toHaveLength(0);
  });

  it("allows and logs when Arcjet errors", async () => {
    state.failure = true;
    expect(await call("signup", "12.0.0.2", "a@example.com")).toEqual({ allowed: true });
    expect(warn.mock.calls.join()).toContain("arcjet_error");
  });
});
