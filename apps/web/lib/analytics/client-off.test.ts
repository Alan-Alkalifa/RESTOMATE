// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { seededError, stubEnv, USER_A } from "./testing/helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe.each([
  ["no key", "NEXT_PUBLIC_POSTHOG_KEY", ""],
  ["no host", "NEXT_PUBLIC_POSTHOG_HOST", ""],
  ["an invalid host", "NEXT_PUBLIC_POSTHOG_HOST", "not a url"],
])("browser analytics with %s", (_, name, value) => {
  it("does nothing and never throws", async () => {
    stubEnv();
    vi.stubEnv(name, value);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const listen = vi.spyOn(window, "addEventListener");
    const store = vi.spyOn(Storage.prototype, "setItem");

    const analytics = await import("./client");
    expect(() => {
      analytics.initAnalytics();
      analytics.capture("signup_completed", { locale: "en" });
      analytics.capturePageview("/login");
      analytics.setAnalyticsUser(USER_A);
      analytics.captureError(seededError());
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetch).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });
});
