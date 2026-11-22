import { getPostHogEnv } from "../env";

let warned = false;

/** Both values or nothing. The host is never guessed: the wrong one is the wrong region. */
export function getAnalyticsConfig(): { key: string; host: string } | undefined {
  let problem: string;
  try {
    const { key, host } = getPostHogEnv();
    if (key && host) return { key, host: host.replace(/\/+$/, "") };
    problem = key ? "NEXT_PUBLIC_POSTHOG_HOST is not set" : "NEXT_PUBLIC_POSTHOG_KEY is not set";
  } catch {
    problem = "NEXT_PUBLIC_POSTHOG_HOST is invalid";
  }

  if (!warned && process.env.NODE_ENV === "development") {
    warned = true;
    console.warn(`[analytics] Off: ${problem}`);
  }
  return undefined;
}
