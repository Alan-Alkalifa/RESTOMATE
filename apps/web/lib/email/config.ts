import { getEmailEnv } from "../env";

export type EmailConfig =
  { delivery: "log" } | { delivery: "resend"; apiKey: string; from: string };

/** Undefined when email isn't configured. `getEmailEnv` refuses log mode in production. */
export function getEmailConfig(): EmailConfig | undefined {
  try {
    const env = getEmailEnv();
    if (env.EMAIL_DELIVERY === "log") return { delivery: "log" };
    if ("RESEND_API_KEY" in env) {
      return { delivery: "resend", apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
    }
  } catch {
    // Reported by the sender as a code. The values never leave lib/env.
  }
  return undefined;
}
