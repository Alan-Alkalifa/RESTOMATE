import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import {
  assertBootEnv,
  assertVercelBuildEnv,
  EnvError,
  getSupabaseEnv,
  validateEnv,
  type EnvSource,
} from "./env";

const SECRET = "s3cr3t-value-DO-NOT-LEAK";
const good: EnvSource = {
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
  NEXT_PUBLIC_ROOT_DOMAIN: "example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: SECRET,
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
  ARCJET_KEY: SECRET,
  RESEND_API_KEY: SECRET,
  EMAIL_FROM: "Restomate <no-reply@mail.example.com>",
  EMAIL_DELIVERY: "resend",
  DOKU_ENV: "sandbox",
  DOKU_CLIENT_ID: SECRET,
  DOKU_SECRET_KEY: SECRET,
  APP_ENCRYPTION_KEY: "a".repeat(64),
};

const names = (s: EnvSource, production = true) => {
  const r = validateEnv(s, { production });
  return r.ok ? [] : r.issues.map((i) => i.name);
};

describe("validateEnv", () => {
  it("accepts a complete production env (anon key fallback)", () => {
    expect(validateEnv(good, { production: true }).ok).toBe(true);
  });
  it("requires a Supabase key in production", () => {
    expect(names({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });
  it("reports every missing production variable by name", () => {
    expect(names({})).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(names({})).toContain("EMAIL_DELIVERY");
  });
  it("treats empty strings as unset and allows an empty env outside production", () => {
    expect(validateEnv({ ARCJET_KEY: "" }, { production: false }).ok).toBe(true);
  });
  it("rejects EMAIL_DELIVERY=log in production but not elsewhere", () => {
    expect(names({ ...good, EMAIL_DELIVERY: "log" })).toEqual(["EMAIL_DELIVERY"]);
    expect(names({ ...good, EMAIL_DELIVERY: "log" }, false)).toEqual([]);
  });
  it("reports malformed and missing variables together", () => {
    const rest = { ...good };
    delete rest.ARCJET_KEY;
    delete rest.DOKU_CLIENT_ID;
    const r = names({ ...rest, NEXT_PUBLIC_APP_URL: "nope", EMAIL_DELIVERY: "log" });
    expect(r.sort()).toEqual([
      "ARCJET_KEY",
      "DOKU_CLIENT_ID",
      "EMAIL_DELIVERY",
      "NEXT_PUBLIC_APP_URL",
    ]);
  });
  it("reports a padded EMAIL_DELIVERY=log once", () => {
    expect(names({ ...good, EMAIL_DELIVERY: " log " })).toEqual(["EMAIL_DELIVERY"]);
  });
  it("rejects DOKU_ENV=production", () => {
    expect(names({ ...good, DOKU_ENV: "production" })).toEqual(["DOKU_ENV"]);
  });
  it("validates formats", () => {
    expect(names({ ...good, NEXT_PUBLIC_APP_URL: "nope" })).toEqual(["NEXT_PUBLIC_APP_URL"]);
    expect(names({ ...good, NEXT_PUBLIC_ROOT_DOMAIN: "https://example.com" })).toEqual([
      "NEXT_PUBLIC_ROOT_DOMAIN",
    ]);
    expect(names({ ...good, APP_ENCRYPTION_KEY: "short" })).toEqual(["APP_ENCRYPTION_KEY"]);
    expect(names({ ...good, APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") })).toEqual(
      [],
    );
  });
  it("never puts a value in an error", () => {
    const bad = {
      ...good,
      NEXT_PUBLIC_APP_URL: SECRET,
      DOKU_ENV: SECRET,
      EMAIL_DELIVERY: SECRET,
      APP_ENCRYPTION_KEY: SECRET,
      NEXT_PUBLIC_ROOT_DOMAIN: SECRET + "/x",
    };
    expect(() =>
      assertVercelBuildEnv({ ...bad, VERCEL: "1", NODE_ENV: "production" }),
    ).toThrowError(EnvError);
    try {
      assertVercelBuildEnv({ ...bad, VERCEL: "1", NODE_ENV: "production" });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(SECRET);
      expect(msg).toContain("NEXT_PUBLIC_APP_URL");
      expect(msg).toContain("Vercel build blocked");
    }
  });
});

describe("build and boot checks", () => {
  it("skips the build check off Vercel", () => {
    expect(() => assertVercelBuildEnv({ NODE_ENV: "production" })).not.toThrow();
  });
  it("blocks the Vercel build on a missing variable", () => {
    expect(() => assertVercelBuildEnv({ VERCEL: "1", NODE_ENV: "production" })).toThrow(
      /ARCJET_KEY/,
    );
  });
  it("blocks a production boot only", () => {
    expect(() => assertBootEnv({ NODE_ENV: "production" })).toThrow(/Boot blocked/);
    expect(() => assertBootEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertBootEnv(good as EnvSource & { NODE_ENV: string })).not.toThrow();
  });
});

describe("next.config", () => {
  const load = (phase: string, command: string, vercelEnv = "preview") => {
    const { argv } = process;
    try {
      for (const name of Object.keys(good)) vi.stubEnv(name, "");
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      process.argv = ["node", "next", command];
      return nextConfig(phase);
    } finally {
      process.argv = argv;
      vi.unstubAllEnvs();
    }
  };

  it.each(["preview", "production"])("blocks a %s build by name", (vercelEnv) => {
    expect(() => load(PHASE_PRODUCTION_BUILD, "build", vercelEnv)).toThrow(/ARCJET_KEY/);
  });
  it.each([
    ["dev", PHASE_DEVELOPMENT_SERVER],
    ["typegen", PHASE_PRODUCTION_BUILD],
    ["start", PHASE_PRODUCTION_SERVER],
  ])("does not run the build check for next %s", (command, phase) => {
    expect(load(phase, command).cacheComponents).toBe(true);
  });
});

describe("getSupabaseEnv", () => {
  const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
    const keep = { ...process.env };
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fn();
    } finally {
      process.env = keep;
    }
  };
  const url = "https://x.supabase.co";

  it("prefers the publishable key when both are set", () => {
    withEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      },
      () => {
        expect(getSupabaseEnv()).toEqual({ url, publishableKey: "pub" });
      },
    );
  });
  it("falls back to the anon key and names the missing variable", () => {
    withEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      },
      () => {
        expect(getSupabaseEnv().publishableKey).toBe("anon");
      },
    );
    withEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      },
      () => {
        expect(() => getSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
      },
    );
  });
});
