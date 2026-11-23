import { request as nextRequest, slidingWindow } from "@arcjet/next";
import { getArcjet, logDecision } from "../arcjet";

/**
 * Preset for the invitation preview (M0-BE-31): the page behind an invitation link asks "who
 * invited me, to what?" before anyone signs in, so there is no user to key on, only the client IP.
 * The token is 256 random bits, so this limit is about load and tidiness, not about guessing; it is
 * loose enough for a venue's staff opening their links from one network.
 *
 * Fails open, with a logged code, when Arcjet is missing or errors (as the other presets do).
 */

export const INVITATION_PREVIEW_LIMIT = { max: 60, interval: 600 } as const; // per IP, seconds

export type InvitationProtection =
  { allowed: true } | { allowed: false; reason: "rate_limited" | "blocked" };

type Client = NonNullable<ReturnType<typeof getArcjet>>;
let client: ReturnType<typeof build> | undefined;

function build(base: Client) {
  // `slidingWindow` without `characteristics` counts per client IP.
  return base.withRule(slidingWindow({ mode: "LIVE", ...INVITATION_PREVIEW_LIMIT }));
}

export function resetInvitationClientForTests() {
  client = undefined;
}

/** `request` is for tests and route handlers; a Server Action leaves it out. */
export async function protectInvitationPreview(
  input: { request?: Parameters<Client["protect"]>[0] } = {},
): Promise<InvitationProtection> {
  const base = getArcjet();
  if (!base) {
    logDecision("arcjet_unconfigured", "invitationPreview");
    return { allowed: true };
  }
  try {
    client ??= build(base);
    const req = input.request ?? (await nextRequest());
    const decision = await client.protect(req);
    if (decision.isErrored()) {
      logDecision("arcjet_error", "invitationPreview");
      return { allowed: true };
    }
    if (!decision.isDenied()) return { allowed: true };
    const reason = decision.reason.isRateLimit() ? "rate_limited" : "blocked";
    logDecision(`arcjet_denied_${reason}`, "invitationPreview");
    return { allowed: false, reason };
  } catch {
    logDecision("arcjet_error", "invitationPreview");
    return { allowed: true };
  }
}
