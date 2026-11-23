import { describe, expect, it } from "vitest";
import { type HostConfig, resolveHost } from "./host";

const prod: HostConfig = {
  appUrl: "https://app.restomate.app",
  rootDomain: "restomate.app",
  lenient: false,
};
const kind = (host: string | null | undefined, c: HostConfig = prod) => resolveHost(host, c);

describe("resolveHost", () => {
  it("serves the root domain and the app host", () => {
    expect(kind("restomate.app")).toEqual({ kind: "root" });
    expect(kind("app.restomate.app")).toEqual({ kind: "app" });
    expect(kind("APP.Restomate.App")).toEqual({ kind: "app" });
  });

  it("resolves <slug>.<root> to a tenant", () => {
    expect(kind("demo.restomate.app")).toEqual({ kind: "tenant", slug: "demo" });
    expect(kind("my-cafe-2.restomate.app")).toEqual({ kind: "tenant", slug: "my-cafe-2" });
  });

  it.each([
    "evil.com",
    "restomate.app.evil.com",
    "evilrestomate.app",
    "a.b.restomate.app",
    "ab.restomate.app",
    "-bad.restomate.app",
    "bad-.restomate.app",
    "x_y.restomate.app",
    "xn--abc.restomate.app",
    "a--b.restomate.app",
    "my--cafe.restomate.app",
    `${"a".repeat(41)}.restomate.app`,
    "",
  ])("returns unknown for %j", (host) => {
    expect(kind(host).kind).toBe("unknown");
  });

  it("returns unknown for a missing host", () => {
    expect(kind(null).kind).toBe("unknown");
    expect(kind(undefined).kind).toBe("unknown");
  });

  it("serves any host only when nothing is configured and lenient", () => {
    expect(resolveHost("localhost:3000", { lenient: true })).toEqual({ kind: "app" });
    expect(resolveHost("localhost:3000", { lenient: false }).kind).toBe("unknown");
  });

  it("matches ports exactly", () => {
    const dev: HostConfig = {
      appUrl: "http://localhost:3000",
      rootDomain: "localhost:3000",
      lenient: true,
    };
    expect(kind("localhost:3000", dev).kind).toBe("app");
    expect(kind("demo.localhost:3000", dev)).toEqual({ kind: "tenant", slug: "demo" });
    expect(kind("localhost:4000", dev).kind).toBe("unknown");
  });

  describe("Vercel preview hosts", () => {
    const preview: HostConfig = {
      ...prod,
      vercelEnv: "preview",
      vercelUrl: "restomate-abc123-alan.vercel.app",
      vercelBranchUrl: "restomate-git-mf-t14-alan.vercel.app",
    };

    it("serves the deployment's own hosts as the app host", () => {
      expect(kind("restomate-abc123-alan.vercel.app", preview).kind).toBe("app");
      expect(kind("restomate-git-mf-t14-alan.vercel.app", preview).kind).toBe("app");
    });

    it("does not serve other vercel.app hosts", () => {
      expect(kind("someone-else.vercel.app", preview).kind).toBe("unknown");
    });

    it.each(["production", "development", undefined])(
      "is off when VERCEL_ENV is %s",
      (vercelEnv) => {
        expect(kind("restomate-abc123-alan.vercel.app", { ...preview, vercelEnv }).kind).toBe(
          "unknown",
        );
      },
    );

    it("ignores a Vercel value that is not an exact vercel.app hostname", () => {
      for (const bad of [
        "evil.com",
        "x.vercel.app.evil.com",
        "https://x.vercel.app",
        "x.vercel.app/y",
      ]) {
        const c = { ...preview, vercelUrl: bad, vercelBranchUrl: undefined };
        expect(kind(bad, c).kind).toBe("unknown");
      }
    });
  });
});
