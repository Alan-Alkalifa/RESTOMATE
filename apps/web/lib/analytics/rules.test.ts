import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cleanDigest, cleanExceptionList, describeError } from "./exception";
import { cleanProperties } from "./payload";
import { SEEDS as S, stubEnv } from "./testing/helpers";
import { cleanPath, cleanReferrer, cleanRoute, cleanUrl } from "./url";

beforeAll(stubEnv);
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("URLs", () => {
  it.each([
    [`/invite/${S.inviteToken}`, "/invite/:id"],
    [`/app/orders/${S.phone}/`, "/app/orders/:id"],
    ["/Login", "/:id"],
    ["/%6Cogin", "/:id"],
    ["/constructor/__proto__", "/:id/:id"],
    ["", "/"],
  ])("cleanPath(%j) is %j", (input, expected) => {
    expect(cleanPath(input)).toBe(expected);
  });

  it("drops route groups and parameters", () => {
    expect(cleanRoute("/(auth)/invite/[token]/page")).toBe("/invite/:id/page");
  });

  it.each([
    [`https://user:${S.password}@app.restomate.test/login`, "https://app.restomate.test/login"],
    [`https://${S.slug}.restomate.test/menu`, "https://tenant.restomate.test/menu"],
    [`https://${S.slug}.example.com/menu`, "https://other/menu"],
    ["https://evilrestomate.test/menu", "https://other/menu"],
    ["https://app.restomate.test.evil.test/", "https://other/"],
    ["mailto:someone@example.com", "https://other"],
    ["javascript:alert(1)", "https://other"],
    ["/relative", "https://other"],
  ])("cleanUrl(%j) is %j", (input, expected) => {
    expect(cleanUrl(input)).toBe(expected);
    expect(cleanUrl(expected).replace(/\/$/, "")).toBe(expected.replace(/\/$/, ""));
  });

  it.each([
    ["", "$direct"],
    [`https://www.google.com/search?q=${S.email}`, "https://google.com"],
    [`https://l.instagram.com/?u=${S.slug}`, "https://instagram.com"],
    [`https://${S.slug}.example.com/`, "https://other"],
    ["https://notgoogle.com/", "https://other"],
  ])("cleanReferrer(%j) is %j", (input, expected) => {
    expect(cleanReferrer(input)).toBe(expected);
    expect(cleanReferrer(expected)).toBe(expected);
  });
});

describe("errors", () => {
  const frame = "    at run (/var/task/.next/server/chunks/ok_1.js:1:2)";
  const forged = `    at x (/var/task/.next/server/${S.firstName}.js:1:2)`;
  const files = (error: unknown) =>
    describeError(error, false).stacktrace?.frames.map((f) => f.filename) ?? [];
  const withStack = (message: string, stack: string) =>
    Object.assign(new Error(message), { stack });

  it("keeps real frames", () => {
    expect(files(withStack("x", `Error: x\n${frame}`))).toEqual([".next/server/chunks/ok_1.js"]);
    expect(files(withStack("", `Error\n${frame}`))).toHaveLength(1);
  });

  it("ignores a frame forged inside the message", () => {
    const message = `oops\n${forged}`;
    expect(files(withStack(message, `Error: ${message}\n${frame}`))).toEqual([
      ".next/server/chunks/ok_1.js",
    ]);
  });

  it("has no frames when the message can't be cut off the stack", () => {
    expect(files(withStack("changed later", `Error: oops\n${forged}`))).toEqual([]);
    expect(files(withStack("", `Error: oops\n${forged}`))).toEqual([]);
    expect(files(withStack("oops", `Error: oops and more\n${forged}`))).toEqual([]);
  });

  it("reads Firefox and Safari stacks", () => {
    const stack = `${S.firstName}@https://x.test/_next/static/chunks/ok-2.js:3:4`;
    expect(files(withStack("x failed", stack))).toEqual(["_next/static/chunks/ok-2.js"]);
  });

  it.each([
    `/var/task/.next/server/${"a1".repeat(20)}.js`,
    `/var/task/.next/server/${S.email}.js`,
    "/var/task/.next/server/../secret.js",
    "/var/task/node_modules/x/index.js",
  ])("drops the file %s", (file) => {
    expect(files(withStack("x", `Error: x\n    at f (${file}:1:2)`))).toEqual([]);
  });

  it("drops a position as long as a phone number", () => {
    const stack = `Error: x\n    at f (/v/.next/server/a.js:1:${S.phone})`;
    expect(files(withStack("x", stack))).toEqual([]);
  });

  it.each([null, undefined, 5, S.email, { message: S.email }, Object.create(null)])(
    "describes %j without its content",
    (thrown) => {
      expect(describeError(thrown, true)).toEqual({
        type: "Error",
        value: "Message removed",
        mechanism: { handled: true, synthetic: false },
      });
    },
  );

  it("survives throwing getters", () => {
    const hostile = Object.defineProperty({}, "stack", {
      get() {
        throw new Error("no");
      },
    });
    expect(() => describeError(hostile, false)).not.toThrow();
  });

  it("cleans a list built elsewhere", () => {
    const list = [
      { type: S.firstName, value: S.email, stacktrace: { frames: [{ filename: S.email }] } },
    ];
    expect(cleanExceptionList(list)).toEqual([
      { type: "Error", value: "Message removed", mechanism: { handled: false, synthetic: false } },
    ]);
  });

  it.each([S.phone, S.localPhone, S.resetToken, "1234567890123"])("drops the digest %s", (v) => {
    expect(cleanDigest(v)).toBeUndefined();
  });
});

describe("events", () => {
  it.each(["not_an_event", "constructor", "toString", "$set", "$groupidentify", "$autocapture"])(
    "drops %s",
    (event) => {
      expect(cleanProperties(event, {})).toBeNull();
    },
  );
});
