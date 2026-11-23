import { request as nextRequest, slidingWindow } from "@arcjet/next";
import { getArcjetEnv } from "../env";
import { getArcjet, logDecision } from "../arcjet";
import { userKey } from "./hash";

/**
 * Presets for the organization Server Actions (M0-BE-21). Two limits each: per client IP, and per
 * signed-in user (keyed by `userKey`, an HMAC, never the raw ID).
 *
 * - `slugCheck`: the live "is this address free?" check while someone types. Loose enough for a
 *   debounced field, tight enough that it can't be used to list which restaurants exist.
 * - `createOrg`: creating a restaurant. The database also caps owned orgs (ORG_CAP); this stops a
 *   burst of attempts before it reaches the database.
 *
 * Fails open, with a logged code, when Arcjet is missing or errors (as the auth presets do).
 */

export type OrgPreset = "slugCheck" | "createOrg";

type Limit = { max: number; interval: number }; // interval in seconds
export const ORG_LIMITS: Record<OrgPreset, { ip: Limit; user: Limit }> = {
  slugCheck: { ip: { max: 60, interval: 600 }, user: { max: 30, interval: 600 } },
  createOrg: { ip: { max: 10, interval: 3600 }, user: { max: 5, interval: 3600 } },
};

export type OrgProtection =
  { allowed: true } | { allowed: false; reason: "rate_limited" | "blocked" };

type Client = NonNullable<ReturnType<typeof getArcjet>>;
const clients = new Map<OrgPreset, ReturnType<typeof buildClient>>();

function buildClient(base: Client, preset: OrgPreset) {
  const limits = ORG_LIMITS[preset];
  // `slidingWindow` without `characteristics` counts per client IP.
  return base
    .withRule(slidingWindow({ mode: "LIVE", ...limits.ip }))
    .withRule(
      slidingWindow({ mode: "LIVE", ...limits.user, characteristics: ["userKey"] }),
    ) as unknown as ReturnType<Client["withRule"]>;
}

export function resetOrgClientsForTests() {
  clients.clear();
}

/**
 * `userId` is the verified user's ID (from `getCurrentUser`), never client input. `request` is for
 * tests and route handlers; a Server Action leaves it out and the request is read from Next.
 */
export async function protectOrg(
  preset: OrgPreset,
  input: { userId: string; request?: Parameters<Client["protect"]>[0] },
): Promise<OrgProtection> {
  const base = getArcjet();
  if (!base) {
    logDecision("arcjet_unconfigured", preset);
    return { allowed: true };
  }
  try {
    let client = clients.get(preset);
    if (!client) {
      client = buildClient(base, preset);
      clients.set(preset, client);
    }
    const req = input.request ?? (await nextRequest());
    const props = { userKey: await userKey(preset, input.userId, getArcjetEnv().ARCJET_KEY) };
    const decision = await (
      client.protect as (r: typeof req, p: object) => ReturnType<Client["protect"]>
    )(req, props);

    if (decision.isErrored()) {
      logDecision("arcjet_error", preset);
      return { allowed: true };
    }
    if (!decision.isDenied()) return { allowed: true };
    const reason = decision.reason.isRateLimit() ? "rate_limited" : "blocked";
    logDecision(`arcjet_denied_${reason}`, preset);
    return { allowed: false, reason };
  } catch {
    logDecision("arcjet_error", preset);
    return { allowed: true };
  }
}
