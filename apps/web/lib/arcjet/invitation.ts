import { request as nextRequest, slidingWindow } from "@arcjet/next";
import { getArcjetEnv } from "../env";
import { getArcjet, logDecision } from "../arcjet";
import { emailKey, userKey } from "./hash";

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
  sendClient = undefined;
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

/**
 * Preset for sending invitation emails (M0-BE-37, BUG-003): `inviteStaff` and `resendInvitation`
 * each email a third party, so an Owner or Manager could mail-bomb one address and hurt the sending
 * domain. Two sliding windows, both per hour:
 *
 * - per signed-in user (`userKey`, an HMAC of the user ID): 30, enough to invite a whole team;
 * - per invitee address (`emailKey`, an HMAC of the normalized, lowercased address): 3, across every
 *   org and every sender, so an address can't be flooded by several managers either.
 *
 * Neither the raw user ID nor the raw address goes to Arcjet, a log or an event. Fails open, with a
 * logged code, when Arcjet is missing or errors (as the other presets do).
 */
export const INVITATION_SEND_LIMITS = {
  user: { max: 30, interval: 3600 },
  invitee: { max: 3, interval: 3600 },
} as const; // interval in seconds

let sendClient: ReturnType<typeof buildSend> | undefined;

function buildSend(base: Client) {
  return base
    .withRule(
      slidingWindow({
        mode: "LIVE",
        ...INVITATION_SEND_LIMITS.user,
        characteristics: ["userKey"],
      }),
    )
    .withRule(
      slidingWindow({
        mode: "LIVE",
        ...INVITATION_SEND_LIMITS.invitee,
        characteristics: ["inviteeKey"],
      }),
    ) as unknown as ReturnType<Client["withRule"]>;
}

/**
 * `userId` is the verified user's ID, `email` the invitee's address (any case). Call it before the
 * database and before any email. `request` is for tests; a Server Action leaves it out.
 */
export async function protectInvitationSend(input: {
  userId: string;
  email: string;
  request?: Parameters<Client["protect"]>[0];
}): Promise<InvitationProtection> {
  const base = getArcjet();
  if (!base) {
    logDecision("arcjet_unconfigured", "invitationSend");
    return { allowed: true };
  }
  try {
    sendClient ??= buildSend(base);
    const req = input.request ?? (await nextRequest());
    const secret = getArcjetEnv().ARCJET_KEY;
    const props = {
      userKey: await userKey("invitationSend", input.userId, secret),
      inviteeKey: await emailKey("invitationSend", input.email, secret),
    };
    const decision = await (
      sendClient.protect as (r: typeof req, p: object) => ReturnType<Client["protect"]>
    )(req, props);
    if (decision.isErrored()) {
      logDecision("arcjet_error", "invitationSend");
      return { allowed: true };
    }
    if (!decision.isDenied()) return { allowed: true };
    const reason = decision.reason.isRateLimit() ? "rate_limited" : "blocked";
    logDecision(`arcjet_denied_${reason}`, "invitationSend");
    return { allowed: false, reason };
  } catch {
    logDecision("arcjet_error", "invitationSend");
    return { allowed: true };
  }
}
