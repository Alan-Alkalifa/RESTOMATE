import { request as nextRequest, slidingWindow, validateEmail } from "@arcjet/next";
import { getArcjetEnv } from "../env";
import { getArcjet, logDecision } from "../arcjet";
import { emailKey, normalizeEmail } from "./hash";

/**
 * Presets for the auth Server Actions (M0-BE-20 calls `protectAuth` before doing any work).
 * Two limits per preset: per client IP, and per email (keyed by `emailKey`, never the address).
 * Signup also refuses disposable and invalid addresses. There is no MX check, because it can
 * refuse real domains (including Indonesian ones) without a reason the user can act on.
 */

export type AuthPreset = "login" | "signup" | "passwordReset" | "resendConfirmation";

type Limit = { max: number; interval: number }; // interval in seconds
export const AUTH_LIMITS: Record<AuthPreset, { ip: Limit; email: Limit }> = {
  // A venue's POS tablets and staff phones often share one public IP, and a shift change can mean
  // a dozen or more logins within minutes. The per-IP limit is therefore loose (60 per 15 min) so
  // it can't lock a whole restaurant out; the per-email limit (5 per 15 min) is what stops
  // guessing against one account.
  login: { ip: { max: 60, interval: 900 }, email: { max: 5, interval: 900 } },
  signup: { ip: { max: 5, interval: 3600 }, email: { max: 3, interval: 3600 } },
  passwordReset: { ip: { max: 5, interval: 3600 }, email: { max: 3, interval: 3600 } },
  resendConfirmation: { ip: { max: 5, interval: 3600 }, email: { max: 3, interval: 3600 } },
};

export type AuthProtection =
  { allowed: true } | { allowed: false; reason: "rate_limited" | "email_rejected" | "blocked" };

type Client = NonNullable<ReturnType<typeof getArcjet>>;
const clients = new Map<string, ReturnType<typeof buildClient>>();

function buildClient(base: Client, preset: AuthPreset, withEmail: boolean) {
  const limits = AUTH_LIMITS[preset];
  // `slidingWindow` without `characteristics` counts per client IP.
  let client = base.withRule(slidingWindow({ mode: "LIVE", ...limits.ip }));
  if (withEmail) {
    client = client.withRule(
      slidingWindow({ mode: "LIVE", ...limits.email, characteristics: ["emailKey"] }),
    ) as unknown as typeof client;
  }
  if (withEmail && preset === "signup") {
    client = client.withRule(
      validateEmail({ mode: "LIVE", deny: ["DISPOSABLE", "INVALID"] }),
    ) as unknown as typeof client;
  }
  return client;
}

export function resetAuthClientsForTests() {
  clients.clear();
}

/**
 * `email` is whatever the user typed; pass it when the form has one. `request` is for tests and
 * route handlers; a Server Action leaves it out and the request is read from Next.
 * Fails open, with a logged code, when Arcjet is missing or errors.
 */
export async function protectAuth(
  preset: AuthPreset,
  input: { email?: string; request?: Parameters<Client["protect"]>[0] } = {},
): Promise<AuthProtection> {
  const base = getArcjet();
  if (!base) {
    logDecision("arcjet_unconfigured", preset);
    return { allowed: true };
  }
  try {
    const email = input.email ? normalizeEmail(input.email) : "";
    const withEmail = email !== "";
    const id = `${preset}:${withEmail}`;
    let client = clients.get(id);
    if (!client) {
      client = buildClient(base, preset, withEmail);
      clients.set(id, client);
    }
    const req = input.request ?? (await nextRequest());
    // Only signup's `validateEmail` needs the address itself. Every other preset gets the keyed
    // hash alone, so a raw address is not sent to Arcjet where it isn't needed.
    const props = withEmail
      ? {
          emailKey: await emailKey(preset, email, getArcjetEnv().ARCJET_KEY),
          ...(preset === "signup" && { email }),
        }
      : {};
    const decision = await (
      client.protect as (r: typeof req, p: object) => ReturnType<Client["protect"]>
    )(req, props);

    if (decision.isErrored()) {
      logDecision("arcjet_error", preset);
      return { allowed: true };
    }
    if (!decision.isDenied()) return { allowed: true };
    const reason = decision.reason.isRateLimit()
      ? "rate_limited"
      : decision.reason.isEmail()
        ? "email_rejected"
        : "blocked";
    logDecision(`arcjet_denied_${reason}`, preset);
    return { allowed: false, reason };
  } catch {
    logDecision("arcjet_error", preset);
    return { allowed: true };
  }
}
