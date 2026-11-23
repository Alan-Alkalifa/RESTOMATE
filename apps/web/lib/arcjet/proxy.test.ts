import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calls, resetFake, state } from "./fake";

vi.mock("@arcjet/next", async () => (await import("./fake")).fakeModule);

import { proxy } from "../../proxy";
import { resetArcjetForTests } from "../arcjet";

const req = (url: string, bot?: string) =>
  new NextRequest(url, {
    headers: { host: new URL(url).host, ...(bot ? { "x-test-bot": bot } : {}) },
  });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.restomate.app");
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate.app");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ARCJET_KEY", "test-arcjet-key-not-real");
  resetFake();
  resetArcjetForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
});

describe("proxy abuse protection", () => {
  it("blocks an unwanted bot on the app host", async () => {
    expect((await proxy(req("https://app.restomate.app/login", "BAD_SCRAPER"))).status).toBe(403);
  });

  it("lets search engines, link previews and people through", async () => {
    for (const bot of ["CATEGORY:SEARCH_ENGINE", "CATEGORY:PREVIEW", undefined]) {
      expect((await proxy(req("https://restomate.app/", bot))).status).toBe(200);
    }
  });

  it("runs shield only on a tenant storefront host", async () => {
    // Bot detection is off there in M0, so even an unknown bot passes.
    expect((await proxy(req("https://demo.restomate.app/", "BAD_SCRAPER"))).status).toBe(200);
  });

  it("never touches the DOKU webhook, even for a bot", async () => {
    const res = await proxy(req("https://app.restomate.app/api/webhooks/doku", "BAD_SCRAPER"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("does not spend a decision on an unknown host", async () => {
    expect((await proxy(req("https://evil.example/", "BAD_SCRAPER"))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("fails open and logs a code when Arcjet errors", async () => {
    state.failure = true;
    expect((await proxy(req("https://app.restomate.app/", "BAD_SCRAPER"))).status).toBe(200);
    expect(warn.mock.calls.join()).toContain("arcjet_error");
  });

  it("fails open without a key", async () => {
    vi.stubEnv("ARCJET_KEY", "");
    resetArcjetForTests();
    expect((await proxy(req("https://app.restomate.app/", "BAD_SCRAPER"))).status).toBe(200);
    expect(warn.mock.calls.join()).toContain("arcjet_unconfigured");
  });

  it("logs no host, path or user agent", async () => {
    await proxy(req("https://app.restomate.app/secret-path", "BAD_SCRAPER"));
    const logged = warn.mock.calls.join();
    for (const v of ["secret-path", "restomate.app", "BAD_SCRAPER"])
      expect(logged).not.toContain(v);
  });
});
