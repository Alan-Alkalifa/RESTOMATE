import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanDigest, describeError, isControlFlow } from "./exception";
import { isUuid } from "./payload";
import { captureServerError } from "./server";
import { eventsIn, readRequest, stubEnv, type Sent } from "./testing/helpers";
import { cleanReferrer, cleanRoute, cleanUrl } from "./url";

// An error can echo user input, and it is parsed on the event loop. The bound is generous: these
// take milliseconds, and the quadratic pattern they guard against took seconds.
const BOUND_MS = 1000;
const TIMEOUT_MS = 30_000;
// The limits in exception.ts.
const MAX_MESSAGE = 8192;
const MAX_STACK = 32_768;

const RUNS = [
  ["line feeds", "\n"],
  ["carriage returns", "\r"],
  ["line separators", " "],
  ["paragraph separators", " "],
  ["spaces", " "],
  ["tabs", "\t"],
  ["colons", ":"],
  ["parentheses", "("],
  ["mixed terminators", "\r\n  "],
  ["indented lines", "\n "],
] as const;

const FRAME = "    at run (/var/task/.next/server/chunks/ok_1.js:1:2)";
const REQUEST_CONTEXT = Symbol.for("@next/request-context");

const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const withStack = (message: string, stack: string) => Object.assign(new Error(message), { stack });
const frames = (error: unknown) => describeError(error, false).stacktrace?.frames ?? [];

function duration(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

let sent: Promise<Sent>[];
let tasks: Promise<unknown>[];

beforeEach(() => {
  stubEnv();
  sent = [];
  tasks = [];
  Object.assign(globalThis, {
    [REQUEST_CONTEXT]: { get: () => ({ waitUntil: (t: Promise<unknown>) => tasks.push(t) }) },
  });
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push(readRequest(String(url), init));
    return Promise.resolve(new Response('{"status":1,"results":{}}', { status: 200 }));
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(RUNS)("a run of %s", (_, unit) => {
  const huge = () => new Error(`bad value ${fill(unit, 50_000)}x`);

  it("over the limit: describeError is fast", { timeout: TIMEOUT_MS }, () => {
    const error = huge();
    expect(duration(() => describeError(error, false))).toBeLessThan(BOUND_MS);
  });

  it(
    "over the limit: captureServerError is fast and still reports",
    { timeout: TIMEOUT_MS },
    async () => {
      const error = huge();
      expect(duration(() => captureServerError(error, { source: "route" }))).toBeLessThan(BOUND_MS);

      await Promise.all(tasks);
      const [event, ...more] = eventsIn(await Promise.all(sent));
      expect(more).toHaveLength(0);
      expect(event.properties.$exception_list).toEqual([
        {
          type: "Error",
          value: "Message removed",
          mechanism: { handled: false, synthetic: false },
        },
      ]);
    },
  );

  // The cap alone would hide a slow pattern, so these stay just under it.
  it("under the stack limit: the matching is linear", { timeout: TIMEOUT_MS }, () => {
    const error = withStack("x", `Error: x\n${fill(unit, MAX_STACK - 100)}x`);
    expect(duration(() => describeError(error, false))).toBeLessThan(BOUND_MS);
  });

  it("under the message limit: the matching is linear", { timeout: TIMEOUT_MS }, () => {
    const message = `bad value ${fill(unit, MAX_MESSAGE - 100)}x`;
    const error = withStack(message, `Error: ${message}\n${FRAME}`);
    const run = () => {
      for (let i = 0; i < 20; i++) describeError(error, false);
    };
    expect(duration(run)).toBeLessThan(BOUND_MS);
    expect(frames(error)).toHaveLength(1);
  });
});

describe("limits", () => {
  it("reads frames at the message limit and none above it", () => {
    const at = "m".repeat(MAX_MESSAGE);
    expect(frames(withStack(at, `Error: ${at}\n${FRAME}`))).toHaveLength(1);

    const over = `${at}m`;
    expect(frames(withStack(over, `Error: ${over}\n${FRAME}`))).toHaveLength(0);
  });

  it("reads frames at the stack limit and none above it", () => {
    const head = `Error: x\n${FRAME}\n`;
    const at = head + "s".repeat(MAX_STACK - head.length);
    expect(frames(withStack("x", at))).toHaveLength(1);
    expect(frames(withStack("x", `${at}s`))).toHaveLength(0);
  });

  it("is fast on the worst frame lines that fit", () => {
    const file = `/v/${".next/server/".repeat(35)}${"a".repeat(20)}`;
    const stack = `Error: x\n${`    at f (${file}:1:2)\n`.repeat(60)}`.slice(0, MAX_STACK);
    const run = () => {
      for (let i = 0; i < 20; i++) describeError(withStack("x", stack), false);
    };
    expect(duration(run)).toBeLessThan(BOUND_MS);
  });
});

// These fields have no limit, so their patterns must stay linear.
describe.each([...RUNS, ["digits", "1"], ["slashes", "/"], ["route groups", "/(a"]] as const)(
  "other fields, a 500 KB run of %s",
  (_, unit) => {
    const value = fill(unit, 500_000);
    it.each([
      [
        "name, code and digest",
        () => {
          const error = { name: value, code: value, digest: value };
          isControlFlow(error);
          cleanDigest(value);
          describeError(error, false);
        },
      ],
      ["route", () => cleanRoute(value)],
      ["URL", () => cleanUrl(`https://app.restomate.test/${value}`)],
      ["referrer", () => cleanReferrer(`https://example.com/?${value}`)],
      ["ID", () => isUuid(value)],
    ] as const)("%s", { timeout: TIMEOUT_MS }, (_field, run) => {
      expect(duration(() => void run())).toBeLessThan(BOUND_MS);
    });
  },
);

describe("forged frames with other whitespace", () => {
  const forged = "at x (/var/task/.next/server/rahayu.js:1:2)";

  it.each(["\n ", "\n\v", "\r ", "  ", "  "])("indent %j", (indent) => {
    const message = `oops${indent}${forged}`;
    // The message was changed later, so it can't be cut off the stack.
    expect(frames(withStack("changed later", `Error: ${message}`))).toHaveLength(0);
    expect(frames(withStack("", `Error: ${message}`))).toHaveLength(0);

    const real = frames(withStack(message, `Error: ${message}\n${FRAME}`));
    expect(real.map((f) => f.filename)).toEqual([".next/server/chunks/ok_1.js"]);
  });
});

it.each(["BAILOUT_TO_CLIENT_SIDE_RENDERING", "HANGING_PROMISE_REJECTION"])(
  "treats %s as control flow",
  (digest) => {
    expect(isControlFlow(Object.assign(new Error("flow"), { digest }))).toBe(true);
  },
);
