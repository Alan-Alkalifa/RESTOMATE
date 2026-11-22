import { z } from "zod";

/**
 * Environment validation (M0-BE-04).
 *
 * A bad variable is reported by NAME and a short reason, never by value.
 * Reasons are written by hand (never taken from a Zod message) so no value can leak.
 *
 * This file must stay free of "@/" aliases and "server-only": next.config.ts and
 * instrumentation.ts import it.
 *
 * Required-ness: production requirements apply when NODE_ENV=production (a Vercel
 * build and runtime, Production and Preview alike). Elsewhere every variable is
 * optional, but a value that is set must still be valid.
 */

export type EnvSource = Record<string, string | undefined>;
export type EnvIssue = { name: string; reason: string };

export class EnvError extends Error {
  readonly issues: EnvIssue[];
  constructor(prefix: string, issues: EnvIssue[]) {
    super(`${prefix}: ${issues.map((i) => `${i.name} (${i.reason})`).join(", ")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

// Empty strings (as in .env.example) count as unset.
const unset = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const text = z.preprocess(unset, z.string().min(1).optional());
const url = z.preprocess(
  unset,
  z
    .string()
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    })
    .optional(),
);
const hostname = z.preprocess(
  unset,
  z
    .string()
    .regex(
      /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i,
    )
    .optional(),
);
function isBase64Of32Bytes(v: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return false;
  try {
    return atob(v).length === 32;
  } catch {
    return false;
  }
}

const encryptionKey = z.preprocess(
  unset,
  z
    .string()
    .refine((v) => /^[0-9a-f]{64}$/i.test(v) || isBase64Of32Bytes(v))
    .optional(),
);

const shape = {
  NEXT_PUBLIC_APP_URL: url,
  NEXT_PUBLIC_ROOT_DOMAIN: hostname,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: text,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: text,
  SUPABASE_SERVICE_ROLE_KEY: text,
  ARCJET_KEY: text,
  RESEND_API_KEY: text,
  EMAIL_FROM: text,
  EMAIL_DELIVERY: z.preprocess(unset, z.enum(["log", "resend"]).optional()),
  // Stays "sandbox" until the project owner approves production payments (M5).
  DOKU_ENV: z.preprocess(unset, z.literal("sandbox").optional()),
  DOKU_CLIENT_ID: text,
  DOKU_SECRET_KEY: text,
  APP_ENCRYPTION_KEY: encryptionKey,
  NEXT_PUBLIC_POSTHOG_KEY: text,
  NEXT_PUBLIC_POSTHOG_HOST: text,
} as const;

const schema = z.object(shape);
export type ServerEnv = z.infer<typeof schema>;

/** Required when NODE_ENV=production. The Supabase key is checked separately (fallback). */
const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_ROOT_DOMAIN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ARCJET_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_DELIVERY",
  "DOKU_ENV",
  "DOKU_CLIENT_ID",
  "DOKU_SECRET_KEY",
  "APP_ENCRYPTION_KEY",
] as const satisfies readonly (keyof ServerEnv)[];

const KEY_REASONS: Partial<Record<string, string>> = {
  NEXT_PUBLIC_APP_URL: "must be an http(s) URL",
  NEXT_PUBLIC_SUPABASE_URL: "must be an http(s) URL",
  NEXT_PUBLIC_ROOT_DOMAIN: "must be a bare hostname, no scheme or path",
  EMAIL_DELIVERY: 'must be "log" or "resend"',
  DOKU_ENV: 'must be "sandbox"',
  APP_ENCRYPTION_KEY: "must be 32 bytes: 64 hex characters or base64",
};

/** Validate a source object. Returns the parsed env, or every problem by name. */
export function validateEnv(
  source: EnvSource,
  opts: { production?: boolean } = {},
): { ok: true; env: ServerEnv } | { ok: false; issues: EnvIssue[] } {
  const production = opts.production ?? source.NODE_ENV === "production";
  const issues: EnvIssue[] = [];
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? "unknown");
      if (!issues.some((i) => i.name === name)) {
        issues.push({ name, reason: KEY_REASONS[name] ?? "is invalid" });
      }
    }
  }
  // Required checks run even when a value is malformed, so every invalid and
  // missing name is reported at once.
  if (production) {
    const reported = new Set(issues.map((i) => i.name));
    const isSet = (name: string) => (source[name] ?? "").trim() !== "";
    for (const name of REQUIRED_IN_PRODUCTION) {
      if (!reported.has(name) && !isSet(name))
        issues.push({ name, reason: "is required in production" });
    }
    if (!isSet("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && !isSet("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
      issues.push({
        name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        reason: "is required in production (or set NEXT_PUBLIC_SUPABASE_ANON_KEY)",
      });
    }
    if (source.EMAIL_DELIVERY === "log") {
      issues.push({ name: "EMAIL_DELIVERY", reason: 'must be "resend" in production' });
    }
  }

  return issues.length > 0 || !parsed.success
    ? { ok: false, issues }
    : { ok: true, env: parsed.data };
}

let cached: ServerEnv | undefined;

/** The whole validated server environment. Prefer the slice getters below. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const result = validateEnv(process.env);
  if (!result.ok) throw new EnvError("[env] Invalid environment", result.issues);
  cached = result.env;
  return cached;
}

/**
 * Public values. Next inlines only static `process.env.NEXT_PUBLIC_X` references,
 * so each one is written out literally. Use this (never a dynamic lookup) for
 * anything that must work in the browser bundle.
 */
export function readPublicEnv(): EnvSource {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  };
}

/**
 * Each module reads only its own slice, so one bad slice cannot break an
 * unrelated path. A slice throws only for its own variables.
 */
function slice<K extends keyof ServerEnv>(
  names: readonly K[],
  label: string,
  source: EnvSource = process.env,
) {
  const mask = Object.fromEntries(names.map((n) => [n, true]));
  const result = schema.pick(mask as never).safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      const name = String(i.path[0] ?? "unknown");
      return { name, reason: KEY_REASONS[name] ?? "is invalid" };
    });
    throw new EnvError(`[env] Invalid ${label} environment`, issues);
  }
  return result.data as unknown as Pick<ServerEnv, K>;
}

function need<K extends keyof ServerEnv>(
  names: readonly K[],
  label: string,
  source: EnvSource = process.env,
) {
  const env = slice(names, label, source);
  const missing = names
    .filter((n) => env[n] === undefined)
    .map((n) => ({ name: String(n), reason: "is required" }));
  if (missing.length > 0) throw new EnvError(`[env] Invalid ${label} environment`, missing);
  return env as Required<Pick<ServerEnv, K>>;
}

/** Supabase public config. The publishable key falls back to the legacy anon key. */
export function getSupabaseEnv() {
  const env = slice(
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ],
    "Supabase",
    readPublicEnv(),
  );
  const publishableKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const issues: EnvIssue[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL)
    issues.push({ name: "NEXT_PUBLIC_SUPABASE_URL", reason: "is required" });
  if (!publishableKey)
    issues.push({
      name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      reason: "is required (or set NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    });
  if (issues.length > 0) throw new EnvError("[env] Invalid Supabase environment", issues);
  return { url: env.NEXT_PUBLIC_SUPABASE_URL as string, publishableKey: publishableKey as string };
}

export const getSupabaseAdminEnv = () => need(["SUPABASE_SERVICE_ROLE_KEY"], "Supabase admin");
export const getAppEnv = () =>
  need(["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_ROOT_DOMAIN"], "app", readPublicEnv());
export const getArcjetEnv = () => need(["ARCJET_KEY"], "Arcjet");
export const getDokuEnv = () => need(["DOKU_ENV", "DOKU_CLIENT_ID", "DOKU_SECRET_KEY"], "DOKU");
export const getEncryptionEnv = () => need(["APP_ENCRYPTION_KEY"], "encryption");

export function getEmailEnv() {
  const env = need(["EMAIL_FROM", "EMAIL_DELIVERY"], "email");
  if (env.EMAIL_DELIVERY === "resend") {
    return { ...env, ...need(["RESEND_API_KEY"], "email") };
  }
  if (process.env.NODE_ENV === "production") {
    throw new EnvError("[env] Invalid email environment", [
      { name: "EMAIL_DELIVERY", reason: 'must be "resend" in production' },
    ]);
  }
  return env;
}

/** PostHog is optional; analytics never blocks the app. */
export function getPostHogEnv() {
  const env = slice(
    ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"],
    "PostHog",
    readPublicEnv(),
  );
  return { key: env.NEXT_PUBLIC_POSTHOG_KEY, host: env.NEXT_PUBLIC_POSTHOG_HOST };
}

/** `next build` on Vercel only: fail the build on a bad or missing variable. */
export function assertVercelBuildEnv(source: EnvSource = process.env): void {
  if (source.VERCEL !== "1") return;
  const result = validateEnv(source, { production: true });
  if (!result.ok)
    throw new EnvError("[env] Vercel build blocked. Invalid environment", result.issues);
}

/**
 * Fails a production instance's startup on a bad environment (names only, never values).
 * Next does not exit: the process stays up and answers 500, except for static files.
 */
export function assertBootEnv(source: EnvSource = process.env): void {
  if (source.NODE_ENV !== "production") return;
  const result = validateEnv(source, { production: true });
  if (!result.ok) throw new EnvError("[env] Boot blocked. Invalid environment", result.issues);
}
