import arcjet, { detectBot, shield } from "@arcjet/next";
import { getArcjetEnv } from "./env";

/**
 * Arcjet client (M0-BE-16). One client built from `ARCJET_KEY` through the `lib/env` getter, plus
 * the presets in `lib/arcjet/*`. Protection only, never authorization.
 *
 * Mode: every rule is LIVE. STAGING.md asks for no DRY_RUN period, so nothing is log-only.
 *
 * Fail open: with no key (local dev, CI) or an Arcjet error, a request is allowed and a decision
 * code is logged. Production requires the key (`lib/env.ts` validates it at build and boot).
 * Logs carry a code and a preset or surface name, never a value.
 */

/** Bots that may still reach the site: search engines, link previews, chat and social unfurlers, uptime monitors, Vercel. */
export const ALLOWED_BOTS = [
  "CATEGORY:SEARCH_ENGINE",
  "CATEGORY:PREVIEW",
  "CATEGORY:MONITOR",
  "CATEGORY:VERCEL",
  // Links shared in Slack, Discord, Bluesky and the like must unfurl; those crawlers only GET.
  "CATEGORY:SLACK",
  "CATEGORY:SOCIAL",
] as const;

export type Surface = "app" | "tenant";

let base: ReturnType<typeof build> | undefined;

function build(key: string) {
  return arcjet({ key, rules: [shield({ mode: "LIVE" })] });
}

/** Shield only. Presets and the bot rule derive from it with `withRule`, so they share one cache. */
export function getArcjet() {
  if (base) return base;
  let key: string;
  try {
    key = getArcjetEnv().ARCJET_KEY;
  } catch {
    return undefined;
  }
  base = build(key);
  return base;
}

/** Test hook: forget the cached client. */
export function resetArcjetForTests() {
  base = undefined;
  appClient = undefined;
}

let appClient: ReturnType<typeof withBots> | undefined;
function withBots(client: NonNullable<ReturnType<typeof getArcjet>>) {
  return client.withRule(detectBot({ mode: "LIVE", allow: [...ALLOWED_BOTS] }));
}

/** A decision code to log. Never a value. */
export function logDecision(code: string, scope: string) {
  console.warn(JSON.stringify({ event: "arcjet", code, scope }));
}

export type Verdict = { allow: true } | { allow: false; reason: "bot" | "shield" | "blocked" };

/**
 * Base protection for `proxy.ts`. App and root hosts get shield and bot detection; tenant
 * storefront hosts get shield only (guest ordering limits come in M4-BE-05).
 */
export async function protectRequest(
  request: Parameters<NonNullable<ReturnType<typeof getArcjet>>["protect"]>[0],
  surface: Surface,
): Promise<Verdict> {
  const client = getArcjet();
  if (!client) {
    logDecision("arcjet_unconfigured", surface);
    return { allow: true };
  }
  try {
    appClient ??= withBots(client);
    const decision = await (surface === "tenant" ? client : appClient).protect(request);
    if (decision.isErrored()) {
      logDecision("arcjet_error", surface);
      return { allow: true };
    }
    if (!decision.isDenied()) return { allow: true };
    const reason = decision.reason.isBot()
      ? "bot"
      : decision.reason.isShield()
        ? "shield"
        : "blocked";
    logDecision(`arcjet_denied_${reason}`, surface);
    return { allow: false, reason };
  } catch {
    logDecision("arcjet_error", surface);
    return { allow: true };
  }
}
