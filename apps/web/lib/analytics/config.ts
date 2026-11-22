import { getPostHogEnv } from "../env";

let warned = false;

/** Both values or nothing. The host is never guessed: the wrong one is the wrong region. */
export function getAnalyticsConfig(): { key: string; host: string } | undefined {
  const { key, host } = getPostHogEnv();
  if (key && host) return { key, host: host.replace(/\/+$/, "") };

  if (!warned && process.env.NODE_ENV === "development") {
    warned = true;
    const missingVariable = key ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_KEY";
    const message = `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`;
    if (typeof window === "undefined") console.warn(message);
    else console.error(message);
  }
  return undefined;
}
