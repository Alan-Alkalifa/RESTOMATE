import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  eventsIn,
  expectNoSeeds,
  HOST,
  ORG,
  readRequest,
  SEEDS as S,
  seededError,
  stubEnv,
  USER_A,
  type Sent,
} from "./testing/helpers";

const REQUEST_CONTEXT = Symbol.for("@next/request-context");

let sent: Promise<Sent>[];
let tasks: Promise<unknown>[];

const settle = async () => {
  await Promise.all(tasks);
  return Promise.all(sent);
};

beforeEach(() => {
  vi.resetModules();
  stubEnv();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  sent = [];
  tasks = [];
  Object.assign(globalThis, {
    [REQUEST_CONTEXT]: { get: () => ({ waitUntil: (t: Promise<unknown>) => tasks.push(t) }) },
  });
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push(readRequest(String(url), init));
    const body = JSON.stringify({ status: 1, results: {} });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what the server sends", () => {
  it("events hold no seed, only allow-listed values", async () => {
    const { captureServerEvent } = await import("./server");
    captureServerEvent({ userId: USER_A, organizationId: ORG }, "member_invited", {
      role: "cashier",
      email: S.email,
      phone: S.phone,
      name: S.firstName,
      token: S.inviteToken,
      $current_url: `https://app.restomate.test/invite/${S.inviteToken}?token_hash=${S.tokenHash}`,
      $referrer: `https://${S.slug}.restomate.test/reset-password/${S.resetToken}`,
      $set: { email: S.email, name: S.lastName },
    } as never);

    const requests = await settle();
    expectNoSeeds(requests);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).origin).toBe(HOST);

    const [event] = eventsIn(requests);
    expect(event.event).toBe("member_invited");
    expect(event.distinct_id).toBe(USER_A);
    expect(event.properties).toMatchObject({
      role: "cashier",
      $groups: { organization: ORG },
      $current_url: "https://app.restomate.test/invite/:id",
      $referrer: "https://tenant.restomate.test/reset-password/:id",
      $ip: null,
      $geoip_disable: true,
    });
    expect(event.properties).not.toHaveProperty("$set");
  });

  it("uses a random personless ID when the user ID is not a UUID", async () => {
    const { captureServerEvent } = await import("./server");
    captureServerEvent({ userId: S.email, organizationId: S.slug }, "organization_created");

    const requests = await settle();
    expectNoSeeds(requests);
    const [event] = eventsIn(requests);
    expect(event.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.properties.$groups).toBeUndefined();
    // Capture v1 can move the property into options.
    const personProfile =
      event.options?.process_person_profile ?? event.properties.$process_person_profile;
    expect(personProfile).toBe(false);
  });

  it("drops an event that is not in the list", async () => {
    const { captureServerEvent } = await import("./server");
    captureServerEvent({}, "not_an_event" as "organization_created");
    expect(await settle()).toEqual([]);
  });

  it.each(["render", "route", "action", "proxy"] as const)(
    "onRequestError (%s) holds no seed and nothing of the request",
    async (routeType) => {
      const { onRequestError } = await import("../../instrumentation");
      await onRequestError(
        seededError(),
        {
          path: `/auth/confirm?token_hash=${S.tokenHash}&email=${S.email}&phone=${S.phone}`,
          method: "POST",
          headers: {
            cookie: `session=${S.accessToken}`,
            authorization: `Bearer ${S.accessToken}`,
            referer: `https://${S.slug}.restomate.test/invite/${S.inviteToken}`,
            "x-forwarded-for": S.phone,
          },
        },
        {
          routerKind: "App Router",
          routePath: `/(auth)/invite/[token]/${S.inviteToken}/page`,
          routeType,
          revalidateReason: undefined,
        },
      );

      const requests = await settle();
      expectNoSeeds(requests);
      const [event] = eventsIn(requests);
      expect(event.event).toBe("$exception");
      expect(event.properties).toMatchObject({
        $exception_source: routeType,
        $exception_route: "/invite/:id/:id/page",
        $exception_list: [{ type: "TypeError", value: "Message removed" }],
      });
      expect(event.properties).not.toHaveProperty("$exception_digest");
    },
  );

  it("keeps a known code and a Next digest", async () => {
    const { captureServerError } = await import("./server");
    const error = Object.assign(new Error(S.email), { code: "23505", digest: "2338192739" });
    captureServerError(error, { source: "action" });

    const requests = await settle();
    expectNoSeeds(requests);
    expect(eventsIn(requests)[0].properties).toMatchObject({
      $exception_digest: "2338192739",
      $exception_list: [{ type: "Error", value: "23505" }],
    });
  });

  it.each(["NEXT_REDIRECT;replace;/invite/x;307;", "NEXT_HTTP_ERROR_FALLBACK;404"])(
    "ignores control flow: %s",
    async (digest) => {
      const { captureServerError } = await import("./server");
      captureServerError(Object.assign(new Error("flow"), { digest }), { source: "render" });
      expect(await settle()).toEqual([]);
    },
  );
});

describe("the server never throws or blocks", () => {
  it.each([
    ["no key", "NEXT_PUBLIC_POSTHOG_KEY", ""],
    ["no host", "NEXT_PUBLIC_POSTHOG_HOST", ""],
    ["an invalid host", "NEXT_PUBLIC_POSTHOG_HOST", "not a url"],
    ["a build", "NEXT_PHASE", "phase-production-build"],
  ])("sends nothing with %s", async (_, name, value) => {
    vi.stubEnv(name, value);
    const { captureServerError, captureServerEvent } = await import("./server");
    expect(() => {
      captureServerEvent({}, "organization_created");
      captureServerError(seededError(), { source: "route" });
    }).not.toThrow();
    expect(await settle()).toEqual([]);
  });

  it("survives an unreachable host, without logging", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", fetch);
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    const { captureServerError } = await import("./server");

    captureServerError(seededError(), { source: "route" });
    await expect(settle()).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1); // no retry
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("returns at once and gives up on a host that never answers", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const { onRequestError } = await import("../../instrumentation");

    const started = performance.now();
    await onRequestError(
      seededError(),
      { path: "/", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/", routeType: "route", revalidateReason: undefined },
    );
    expect(performance.now() - started).toBeLessThan(1000);

    await settle();
    expect(performance.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("works with no request context at all", async () => {
    Reflect.deleteProperty(globalThis, REQUEST_CONTEXT);
    const { captureServerEvent } = await import("./server");
    expect(() => captureServerEvent({}, "organization_created")).not.toThrow();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it("caps sends in flight", async () => {
    const { captureServerEvent } = await import("./server");
    for (let i = 0; i < 60; i++) captureServerEvent({}, "organization_created");
    expect(eventsIn(await settle())).toHaveLength(50);
  });
});

describe("the boot check", () => {
  it("still fails closed, by name and without the value", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENCRYPTION_KEY", "dummy-bad-value");
    const { register } = await import("../../instrumentation");
    expect(register).toThrow(/Boot blocked.*APP_ENCRYPTION_KEY/);
    expect(register).not.toThrow(/dummy-bad-value/);
    expect(await settle()).toEqual([]);
  });
});
