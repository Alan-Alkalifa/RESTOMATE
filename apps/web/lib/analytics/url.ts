import { getAppEnv } from "../env";

/**
 * Path segments that may leave the app. Everything else becomes `:id`, so a token, slug, name,
 * email or phone in a path is masked without having to recognize it. A new static route shows as
 * `:id` until its word is added here.
 */
const ROUTE_WORDS = new Set(
  `accept account admin api app areas auth billing bills branding callback cart cash-up categories
  checkout confirm customers dashboard discounts doku error feedback forgot-password invitations
  invite items kds kitchen locations login logout menu modifiers new notifications onboarding order
  orders organizations packages page payments platform pos pricing printing privacy profile reports
  reservations reset-password roles route security settings signup staff subscriptions suspended t
  tables terms verify webhook webhooks`.split(/\s+/),
);

/** Keys and values are both allow-listed: a free-text campaign value can hold a name. */
const QUERY_VALUES = new Map<string, readonly string[]>([
  ["lang", ["en", "id"]],
  ["utm_source", ["google", "facebook", "instagram", "tiktok", "whatsapp", "email", "qr"]],
  ["utm_medium", ["cpc", "email", "organic", "social", "referral", "qr"]],
]);

/** Other referrers become `other`: a host name can be a person's name. */
const REFERRER_SITES = [
  "google.com",
  "google.co.id",
  "bing.com",
  "duckduckgo.com",
  "yahoo.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "t.co",
  "x.com",
  "whatsapp.com",
  "youtube.com",
];

const OTHER = "https://other";

export function cleanPath(path: unknown): string {
  if (typeof path !== "string") return "/";
  const segments = path
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .slice(0, 10)
    .map((segment) => (ROUTE_WORDS.has(segment) ? segment : ":id"));
  return `/${segments.join("/")}`;
}

/** A Next route template, e.g. `/(auth)/invite/[token]/page`. */
export function cleanRoute(route: unknown): string {
  return cleanPath(typeof route === "string" ? route.replace(/\/\([a-z-]+\)/g, "") : undefined);
}

/** The app host, the root domain, or `tenant.<root>` (a slug can be a person's name). */
function ownHost(url: URL): string | undefined {
  try {
    const env = getAppEnv();
    const app = new URL(env.NEXT_PUBLIC_APP_URL).host;
    const root = env.NEXT_PUBLIC_ROOT_DOMAIN.toLowerCase();
    if (url.host === app || url.host === root) return url.host;
    if (url.host.endsWith(`.${root}`)) return `tenant.${root}`;
  } catch {
    // No app env: no host is known, so none is sent.
  }
  return undefined;
}

function parse(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Takes an absolute URL. Drops credentials and the fragment, masks host, path and query. */
export function cleanUrl(value: unknown): string {
  const url = parse(value);
  if (!url) return OTHER;

  const query = new URLSearchParams();
  QUERY_VALUES.forEach((allowed, key) => {
    const found = url.searchParams.get(key);
    if (found !== null && allowed.includes(found)) query.set(key, found);
  });

  const host = ownHost(url);
  const origin = host ? `${url.protocol}//${host}` : OTHER;
  const search = query.toString();
  return `${origin}${cleanPath(url.pathname)}${search ? `?${search}` : ""}`;
}

export function cleanReferrer(value: unknown): string {
  if (!value || value === "$direct") return "$direct";
  const url = parse(value);
  if (!url) return OTHER;
  if (ownHost(url)) return cleanUrl(value);

  const site = REFERRER_SITES.find((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
  return site ? `https://${site}` : OTHER;
}
