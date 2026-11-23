/**
 * Host resolution for `proxy.ts` (pure: no Next imports, so it is unit tested directly).
 * Routing only. A host never grants access to anything.
 */

export type HostKind = "root" | "app" | "tenant" | "unknown";
export type ResolvedHost = { kind: HostKind; slug?: string };

export type HostConfig = {
  /** `NEXT_PUBLIC_APP_URL`, as set. */
  appUrl?: string;
  /** `NEXT_PUBLIC_ROOT_DOMAIN`, a bare hostname (with a port locally). */
  rootDomain?: string;
  /** Vercel system env, read from `process.env` by the caller, never from a request header. */
  vercelEnv?: string;
  vercelUrl?: string;
  vercelBranchUrl?: string;
  /** True when unset config should mean "serve everything" (local dev and tests only). */
  lenient: boolean;
};

const PREVIEW_HOST =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.vercel\.app$/;
const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

const lower = (v: string | undefined) => v?.trim().toLowerCase() || undefined;

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The deployment's own hosts, on a Vercel preview deployment only. Exact `*.vercel.app` names. */
export function previewHosts(config: HostConfig): string[] {
  if (config.vercelEnv !== "preview") return [];
  return [lower(config.vercelUrl), lower(config.vercelBranchUrl)].filter(
    (h): h is string => h !== undefined && PREVIEW_HOST.test(h),
  );
}

/**
 * `host` is the request's `Host` (with port, if any). Anything that is not the root domain, the
 * app host, a preview host or `<slug>.<root domain>` is "unknown" and gets a 404.
 */
export function resolveHost(rawHost: string | null | undefined, config: HostConfig): ResolvedHost {
  const host = lower(rawHost ?? undefined);
  if (!host) return { kind: "unknown" };

  const root = lower(config.rootDomain);
  const app = hostOf(config.appUrl);

  if (!root && !app) {
    // Nothing configured. Production validates this at boot, so this is local dev or a test.
    return config.lenient ? { kind: "app" } : { kind: "unknown" };
  }

  if (previewHosts(config).includes(host)) return { kind: "app" };
  if (app && host === app) return { kind: "app" };
  if (root && host === root) return { kind: "root" };

  if (root && host.endsWith(`.${root}`)) {
    const slug = host.slice(0, -(root.length + 1));
    // One label only: `a.b.<root>` is not a tenant. Reserved and unknown slugs are the
    // storefront's decision (M4-BE-01); the shape is checked here so the header is always safe.
    if (SLUG.test(slug)) return { kind: "tenant", slug };
  }
  return { kind: "unknown" };
}
