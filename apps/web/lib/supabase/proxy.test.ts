import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOKU_WEBHOOK_PATH, TENANT_HEADER, proxy } from "../../proxy";
import { AUTH_DOWN_HEADER } from "./signal";

const seen = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

const req = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.restomate.app");
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate.app");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  it("returns 404 for an unknown host", async () => {
    const res = await proxy(req("https://evil.example/login"));
    expect(res.status).toBe(404);
  });

  it("serves the app host", async () => {
    const res = await proxy(req("https://app.restomate.app/login"));
    expect(res.status).toBe(200);
  });

  it("opens a Vercel preview URL on a preview deployment only", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "restomate-abc123-alan.vercel.app");
    const res = await proxy(req("https://restomate-abc123-alan.vercel.app/login"));
    expect(res.status).toBe(200);

    vi.stubEnv("VERCEL_ENV", "production");
    expect((await proxy(req("https://restomate-abc123-alan.vercel.app/login"))).status).toBe(404);
  });

  it("sets the tenant header from the host and drops a client-sent one", async () => {
    const res = await proxy(req("https://demo.restomate.app/", { [TENANT_HEADER]: "victim" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-restomate-tenant")).toBe("demo");

    const app = await proxy(req("https://app.restomate.app/", { [TENANT_HEADER]: "victim" }));
    expect(app.headers.get("x-middleware-request-x-restomate-tenant")).toBeNull();
  });

  it("strips a client-sent tenant header on the webhook path too", async () => {
    const res = await proxy(
      req(`https://app.restomate.app${DOKU_WEBHOOK_PATH}`, { [TENANT_HEADER]: "victim" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get(`x-middleware-request-${TENANT_HEADER}`)).toBeNull();
  });

  it("passes the DOKU webhook through, even on an unknown host", async () => {
    const res = await proxy(req(`https://other.example${DOKU_WEBHOOK_PATH}`));
    expect(res.status).toBe(200);
  });

  it("does not call Supabase without an auth cookie", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await proxy(req("https://app.restomate.app/app"));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps serving when the session refresh fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await proxy(
      req("https://app.restomate.app/app", { cookie: "sb-ref-auth-token=garbage" }),
    );
    expect(res.status).toBe(200);
  });

  describe("the 'Auth is down' request signal", () => {
    const withCookie = { cookie: "sb-ref-auth-token=garbage" };

    it("is set when the refresh in this request failed", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      const res = await proxy(req("https://app.restomate.app/app", withCookie));
      expect(seen(res, AUTH_DOWN_HEADER)).toBe("1");
    });

    it("is never set when there is nothing to refresh", async () => {
      const res = await proxy(req("https://app.restomate.app/app"));
      expect(seen(res, AUTH_DOWN_HEADER)).toBeNull();
    });

    it("is dropped when a client sends it, on every path", async () => {
      const fake = { [AUTH_DOWN_HEADER]: "1" };
      expect(
        seen(await proxy(req("https://app.restomate.app/app", fake)), AUTH_DOWN_HEADER),
      ).toBeNull();
      expect(
        seen(await proxy(req("https://demo.restomate.app/", fake)), AUTH_DOWN_HEADER),
      ).toBeNull();
      expect(
        seen(
          await proxy(req(`https://app.restomate.app${DOKU_WEBHOOK_PATH}`, fake)),
          AUTH_DOWN_HEADER,
        ),
      ).toBeNull();
    });
  });
});
