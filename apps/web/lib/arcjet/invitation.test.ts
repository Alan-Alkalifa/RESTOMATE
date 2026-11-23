import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, calls, resetFake, state } from "./fake";

vi.mock("@arcjet/next", async () => (await import("./fake")).fakeModule);

import { resetArcjetForTests } from "../arcjet";
import {
  INVITATION_PREVIEW_LIMIT,
  protectInvitationPreview,
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
