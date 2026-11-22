// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://app.restomate.test/app/orders/first"}
import { afterAll, expect, it, vi } from "vitest";

import { eventsIn, readRequest, stubEnv, USER_A, type Sent } from "./testing/helpers";

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("a returning user keeps the ID until sign-out, and each masked page still counts", async () => {
  stubEnv();
  const sent: Promise<Sent>[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push(readRequest(String(url), init));
    return Promise.resolve(new Response('{"status":1}', { status: 200 }));
  });
  localStorage.setItem("restomate.analytics_user", USER_A);

  const analytics = await import("./client");
  analytics.initAnalytics();
  analytics.setAnalyticsUser(USER_A);
  analytics.capturePageview("/app/orders/second"); // the same masked URL, another page
  analytics.capturePageview("/app/orders/second"); // the same page
  analytics.setAnalyticsUser(null);
  analytics.capturePageview("/login");

  await vi.waitFor(async () => expect(eventsIn(await Promise.all(sent))).toHaveLength(3), {
    timeout: 8000,
    interval: 100,
  });
  const events = eventsIn(await Promise.all(sent));
  expect(events.map((e) => e.event)).toEqual(["$pageview", "$pageview", "$pageview"]);

  const ids = events.map((e) => e.distinct_id ?? e.properties.distinct_id);
  expect(ids.slice(0, 2)).toEqual([USER_A, USER_A]);
  expect(ids[2]).not.toBe(USER_A);
  expect(localStorage.getItem("restomate.analytics_user")).toBeNull();
  expect(localStorage.getItem("restomate.analytics_id")).toBe(ids[2]);
}, 15_000);
