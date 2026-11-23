import { getEmailEnv } from "../env";

export type EmailConfig =
  { delivery: "log" } | { delivery: "resend"; apiKey: string; from: string };

/** Undefined when email isn't configured. `getEmailEnv` refuses log mode in production. */
export function getEmailConfig(): EmailConfig | undefined {
  try {
    const env: { EMAIL_DELIVERY: "log" | "resend"; EMAIL_FROM: string; RESEND_API_KEY?: string } =
      getEmailEnv();
    if (env.EMAIL_DELIVERY === "log") return { delivery: "log" };
    if (env.RESEND_API_KEY) {
      return { delivery: "resend", apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
    }
  } catch {
    // Reported by the sender as a code. The values never leave lib/env.
  }
  return undefined;
}
