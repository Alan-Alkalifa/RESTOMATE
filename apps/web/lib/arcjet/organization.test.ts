import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, calls, resetFake, state } from "./fake";

vi.mock("@arcjet/next", async () => (await import("./fake")).fakeModule);

import { resetArcjetForTests } from "../arcjet";
import { userKey } from "./hash";
import { ORG_LIMITS, protectOrg, resetOrgClientsForTests } from "./organization";

const SECRET = "test-arcjet-key-not-real";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const req = (ip: string): FakeRequest => ({ ip });
const call = (preset: "slugCheck" | "createOrg", userId: string, ip: string) =>
  protectOrg(preset, { userId, request: req(ip) as never });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("ARCJET_KEY", SECRET);
  resetFake();
  resetArcjetForTests();
  resetOrgClientsForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
});

describe.each(["slugCheck", "createOrg"] as const)("%s", (preset) => {
  it("denies one user past the per-user limit, even from many IPs", async () => {
    const max = ORG_LIMITS[preset].user.max;
    for (let i = 0; i < max; i++) {
      expect(await call(preset, U1, `10.0.${i}.1`)).toEqual({ allowed: true });
    }
    expect(await call(preset, U1, "10.9.9.9")).toEqual({ allowed: false, reason: "rate_limited" });
    expect(await call(preset, U2, "10.9.9.9")).toEqual({ allowed: true }); // another user is fine
  });

  it("denies one IP past the per-IP limit, even across many users", async () => {
    const max = ORG_LIMITS[preset].ip.max;
    const out = [];
    for (let i = 0; i <= max; i++) {
      const user = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      out.push(await call(preset, user, "10.1.1.1"));
    }
    expect(out.slice(0, max).every((r) => r.allowed)).toBe(true);
    expect(out[max]).toEqual({ allowed: false, reason: "rate_limited" });
  });
});

describe("keys and failure", () => {
  it("sends a keyed hash, never the user ID, and keeps presets apart", async () => {
    await call("slugCheck", U1, "10.0.0.1");
    await call("createOrg", U1, "10.0.0.1");
    const sent = calls.map((c) => c.props.userKey);
    expect(sent[0]).toBe(await userKey("slugCheck", U1, SECRET));
    expect(sent[1]).toBe(await userKey("createOrg", U1, SECRET));
    expect(sent[0]).not.toBe(sent[1]);
    expect(JSON.stringify(calls)).not.toContain(U1);
  });

  it("fails open with a logged code when Arcjet errors or has no key", async () => {
    state.failure = true;
    expect(await call("createOrg", U1, "10.0.0.1")).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("arcjet_error"));

    vi.stubEnv("ARCJET_KEY", "");
    resetArcjetForTests();
    expect(await call("createOrg", U1, "10.0.0.1")).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("arcjet_unconfigured"));
  });
});
