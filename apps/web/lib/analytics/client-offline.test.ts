// @vitest-environment jsdom
import { afterAll, expect, it, vi } from "vitest";

import { seededError, stubEnv, USER_A } from "./testing/helpers";

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("an unreachable host and blocked storage never throw, block or report themselves", async () => {
  stubEnv();
  const fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
  vi.stubGlobal("fetch", fetch);
  for (const method of ["getItem", "setItem", "removeItem"] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error("SecurityError");
    });
  }
  const failures = vi.fn();
  window.addEventListener("unhandledrejection", failures);
  process.on("unhandledRejection", failures);

  const analytics = await import("./client");
  const started = performance.now();
  analytics.initAnalytics();
  analytics.capture("signup_completed", { locale: "en" });
  analytics.setAnalyticsUser(USER_A);
  analytics.captureError(seededError());
  expect(performance.now() - started).toBeLessThan(250);

  await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 8000, interval: 100 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(failures).not.toHaveBeenCalled();
  process.off("unhandledRejection", failures);
}, 15_000);
