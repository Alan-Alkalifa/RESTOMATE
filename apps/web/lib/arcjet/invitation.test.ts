import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, calls, resetFake, state } from "./fake";

vi.mock("@arcjet/next", async () => (await import("./fake")).fakeModule);

import { resetArcjetForTests } from "../arcjet";
import {
  INVITATION_PREVIEW_LIMIT,
  INVITATION_SEND_LIMITS,
  protectInvitationPreview,
  protectInvitationSend,
  resetInvitationClientForTests,
} from "./invitation";

const req = (ip: string): FakeRequest => ({ ip });
const call = (ip: string) => protectInvitationPreview({ request: req(ip) as never });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("ARCJET_KEY", "test-arcjet-key-not-real");
  resetFake();
  resetArcjetForTests();
  resetInvitationClientForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
});

describe("invitation preview preset", () => {
  it("denies one IP past its limit and leaves other IPs alone", async () => {
    for (let i = 0; i < INVITATION_PREVIEW_LIMIT.max; i++) {
      expect(await call("10.0.0.1")).toEqual({ allowed: true });
    }
    expect(await call("10.0.0.1")).toEqual({ allowed: false, reason: "rate_limited" });
    expect(await call("10.0.0.2")).toEqual({ allowed: true });
  });

  it("sends nothing to Arcjet but the request (no token, no user key)", async () => {
    await call("10.0.0.1");
    expect(calls).toHaveLength(1);
    expect(calls[0].props).toEqual({});
  });

  it("fails open with a logged code when Arcjet errors or has no key", async () => {
    state.failure = true;
    expect(await call("10.0.0.1")).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("arcjet_error"));

    vi.stubEnv("ARCJET_KEY", "");
    resetArcjetForTests();
    resetInvitationClientForTests();
    expect(await call("10.0.0.1")).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("arcjet_unconfigured"));
  });
});

describe("invitation send preset", () => {
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const send = (userId: string, email: string) =>
    protectInvitationSend({ userId, email, request: req("10.0.0.1") as never });

  it("denies the 4th send to one address (case and spacing ignored), from any user", async () => {
    for (let i = 0; i < INVITATION_SEND_LIMITS.invitee.max; i++)
      expect(await send(i % 2 ? U1 : U2, "siti@example.com")).toEqual({ allowed: true });
    expect(await send(U1, " SITI@Example.com ")).toEqual({
      allowed: false,
      reason: "rate_limited",
    });
    expect(await send(U1, "budi@example.com")).toEqual({ allowed: true });
  });

  it("denies one user past their hourly limit and leaves other users alone", async () => {
    for (let i = 0; i < INVITATION_SEND_LIMITS.user.max; i++)
      expect(await send(U1, `s${i}@example.com`)).toEqual({ allowed: true });
    expect(await send(U1, "x@example.com")).toEqual({ allowed: false, reason: "rate_limited" });
    expect(await send(U2, "x@example.com")).toEqual({ allowed: true });
  });

  it("sends Arcjet only hashes: no raw user ID or address", async () => {
    await send(U1, "Siti@Example.com");
    const props = JSON.stringify(calls[0].props);
    expect(props).not.toContain(U1);
    expect(props.toLowerCase()).not.toContain("siti");
    expect(calls[0].props).toEqual({
      userKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      inviteeKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("fails open with a logged code when Arcjet errors or has no key", async () => {
    state.failure = true;
    expect(await send(U1, "a@example.com")).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("arcjet_error"));
    state.failure = false;
    vi.stubEnv("ARCJET_KEY", "");
    resetArcjetForTests();
    resetInvitationClientForTests();
    expect(await send(U1, "a@example.com")).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("arcjet_unconfigured"));
  });
});
